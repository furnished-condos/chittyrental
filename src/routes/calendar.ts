import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crProperties, crUnits } from "../db/schema";
import { RESOURCE_DOMAIN, short } from "../lib/gam";
import { resolvePropertyChannels } from "../lib/channels";
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

  const units = await (body.unit_id
    ? db.select().from(crUnits).where(eq(crUnits.id, body.unit_id))
    : db.select().from(crUnits));

  // Preload all referenced properties in one query to avoid N+1.
  const propertyIds = [
    ...new Set(
      (units as Array<typeof crUnits.$inferSelect>).map((u) => u.property_id)
    ),
  ];
  const props = propertyIds.length
    ? await db
        .select()
        .from(crProperties)
        .where(inArray(crProperties.id, propertyIds))
    : [];
  const propById = new Map(
    (props as Array<typeof crProperties.$inferSelect>).map((p) => [p.id, p])
  );

  const results: Array<{
    unit_id: string;
    channel: string;
    events: number;
    error?: string;
  }> = [];

  for (const unit of units as Array<typeof crUnits.$inferSelect>) {
    const prop = propById.get(unit.property_id);
    if (!prop) continue;
    const feeds = resolvePropertyChannels({
      id: prop.id,
      airbnb_id: prop.airbnb_id,
      furnished_finder_id: prop.furnished_finder_id,
      booking_id: prop.booking_id,
      zillow_id: prop.zillow_id,
      apartments_id: prop.apartments_id,
      metadata: prop.metadata as Record<string, unknown> | null,
    }).filter((f) => f.icalUrl);
    // Fetch all resolvable feeds for the unit concurrently.
    const perFeed = await Promise.all(
      feeds.map(async (f) => {
        try {
          const events = await pullIcal(f.icalUrl!);
          return { unit_id: unit.id, channel: f.channel, events: events.length };
        } catch (err) {
          return {
            unit_id: unit.id,
            channel: f.channel,
            events: 0,
            error: String(err),
          };
        }
      })
    );
    results.push(...perFeed);
  }

  return c.json({ data: results });
});

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
      : `unit-${short(unit.id)}@${RESOURCE_DOMAIN}`;

  const startDate = payload.scheduled_for
    ? new Date(payload.scheduled_for)
    : new Date();
  if (Number.isNaN(startDate.getTime())) {
    return c.json({ error: "scheduled_for must be a valid ISO timestamp" }, 400);
  }
  const start = startDate.toISOString();
  const end = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();

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
        // Deterministic sourceId so retries or duplicate webhook deliveries
        // patch the same event instead of piling up duplicates.
        sourceId: payload.scheduled_for
          ? `fanout:${payload.type}:${payload.scheduled_for}`
          : `fanout:${payload.type}`,
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
