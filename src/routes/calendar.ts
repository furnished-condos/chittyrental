import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crProperties, crUnits } from "../db/schema";
import {
  forwardToHomeAssistant,
  pullIcal,
  renderIcal,
  signIcalUrl,
  upsertEvent,
  verifyIcalSig,
  type BusyBlock,
  type FanoutPayload,
} from "../lib/calendar-hub";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Public iCal export (no auth — signed URL)
// ---------------------------------------------------------------------------

// Mounted at /api/calendar — but iCal export must be unauthenticated, so we
// also mount this handler at /ical/* via src/index.ts bypass. Here we keep
// the authenticated surface.

app.get("/availability/:unitId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const unitId = c.req.param("unitId");
  const [unit] = await db.select().from(crUnits).where(eq(crUnits.id, unitId)).limit(1);
  if (!unit) return c.json({ error: "unit not found" }, 404);
  // TODO: fetch actual busy blocks from the unit's calendar resource
  // Placeholder: return empty array until calendar resource is provisioned
  return c.json({ data: { unit_id: unitId, busy: [] as BusyBlock[] } });
});

// ---------------------------------------------------------------------------
// iCal pull (worker cron or manual trigger)
// ---------------------------------------------------------------------------

app.post("/ical/pull", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req
    .json<{ unit_id?: string }>()
    .catch(() => ({} as { unit_id?: string }));

  const query = body.unit_id
    ? db.select().from(crUnits).where(eq(crUnits.id, body.unit_id))
    : db.select().from(crUnits);
  const units = await query;

  const CHANNEL_KEYS = [
    ["airbnb_id", "airbnb"],
    ["furnished_finder_id", "furnished_finder"],
    ["booking_id", "booking"],
  ] as const;

  const results: Array<{ unit_id: string; channel: string; events: number; error?: string }> = [];
  for (const unit of units) {
    const [prop] = await db
      .select()
      .from(crProperties)
      .where(eq(crProperties.id, unit.property_id))
      .limit(1);
    if (!prop) continue;

    for (const [key, channel] of CHANNEL_KEYS) {
      const externalId = prop[key];
      if (!externalId) continue;
      const feedUrl = icalFeedUrl(channel, externalId);
      if (!feedUrl) continue;
      try {
        const events = await pullIcal(feedUrl);
        results.push({ unit_id: unit.id, channel, events: events.length });
        // TODO: upsert each event onto the unit calendar via upsertEvent()
      } catch (err) {
        results.push({ unit_id: unit.id, channel, events: 0, error: String(err) });
      }
    }
  }

  return c.json({ data: results });
});

function icalFeedUrl(channel: string, id: string): string | null {
  // Channel iCal URL shapes — these are the public paths each platform
  // exposes for a given listing id. If a channel requires auth or a token,
  // wrap the id value in a secret stored in cr_properties.metadata.
  switch (channel) {
    case "airbnb":
      return `https://www.airbnb.com/calendar/ical/${id}.ics`;
    case "vrbo":
      return `https://www.vrbo.com/icalendar/${id}.ics`;
    case "booking":
      return null; // Booking.com sync is OTA-style, not iCal
    case "furnished_finder":
      return null; // Furnished Finder has per-account iCal; store URL in metadata
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Fan-out webhook
// ---------------------------------------------------------------------------

app.post("/fanout", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const payload = await c.req.json<FanoutPayload>();
  if (!c.env.GOOGLE_SA_KEY || !c.env.ICAL_SECRET) {
    return c.json({ error: "calendar hub not configured" }, 400);
  }

  const [unit] = await db
    .select()
    .from(crUnits)
    .where(eq(crUnits.id, payload.unit_id))
    .limit(1);
  if (!unit) return c.json({ error: "unit not found" }, 404);
  const [prop] = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.id, unit.property_id))
    .limit(1);
  if (!prop) return c.json({ error: "property not found" }, 404);

  const meta = (unit.metadata as Record<string, unknown> | null) ?? {};
  const resourceEmail =
    typeof meta.resource_email === "string"
      ? (meta.resource_email as string)
      : `unit-${unit.id.replace(/-/g, "").slice(0, 8)}@resources.chitty.cc`;

  const start = payload.scheduled_for ?? new Date().toISOString();
  const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();

  let eventId: string | undefined;
  try {
    const result = await upsertEvent(
      {
        GOOGLE_SA_KEY: c.env.GOOGLE_SA_KEY,
        GOOGLE_SA_SUBJECT: c.env.GOOGLE_SA_SUBJECT,
        ICAL_SECRET: c.env.ICAL_SECRET,
      },
      {
        unitCalendarId: resourceEmail,
        unitId: unit.id,
        propertyId: prop.id,
        type: payload.type,
        sourceId: `fanout-${Date.now()}`,
        status: "scheduled",
        source: "chittyrental",
        title: payload.title,
        description: payload.body,
        startIso: start,
        endIso: end,
      }
    );
    eventId = result.id;
  } catch (err) {
    return c.json({ error: `calendar write failed: ${err}` }, 500);
  }

  const propMeta = (prop.metadata as Record<string, unknown> | null) ?? {};
  const haUrl =
    typeof propMeta.home_assistant_webhook === "string"
      ? (propMeta.home_assistant_webhook as string)
      : null;
  await forwardToHomeAssistant(haUrl, payload);

  return c.json({ data: { event_id: eventId, home_assistant: haUrl ? "forwarded" : "skipped" } });
});

// ---------------------------------------------------------------------------
// Signed iCal URL helper (returns the URL for a unit)
// ---------------------------------------------------------------------------

app.get("/ical/url/:unitId", async (c) => {
  if (!c.env.ICAL_SECRET) return c.json({ error: "ICAL_SECRET not set" }, 400);
  const unitId = c.req.param("unitId");
  const base = new URL(c.req.url).origin;
  const url = await signIcalUrl(base, unitId, c.env.ICAL_SECRET);
  return c.json({ data: { url } });
});

export default app;

// ---------------------------------------------------------------------------
// Unauthenticated iCal export sub-app — mounted at /ical in index.ts
// ---------------------------------------------------------------------------

export const publicIcal = new Hono<AppEnv>();

publicIcal.get("/export/:unitIdDotIcs{[^/]+\\.ics}", async (c) => {
  if (!c.env.ICAL_SECRET) return c.text("ical not configured", 503);
  const raw = c.req.param("unitIdDotIcs");
  const unitId = raw.replace(/\.ics$/, "");
  const sig = c.req.query("sig") ?? "";
  const ok = await verifyIcalSig(unitId, sig, c.env.ICAL_SECRET);
  if (!ok) return c.text("invalid signature", 403);

  // TODO: fetch busy blocks from unit calendar + lease/maintenance tables
  const blocks: BusyBlock[] = [];
  const body = renderIcal(unitId, blocks);
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "max-age=60, public",
    },
  });
});
