/**
 * Calendar hub — per-unit calendar is the central availability + event SoT.
 *
 * Handles:
 *  - Writing events to the unit's Calendar Resource calendar (Google Calendar API)
 *  - Tagging events with chitty.* extendedProperties
 *  - Pulling iCal feeds from external channels (Airbnb, VRBO, etc.)
 *  - Emitting a signed iCal export per unit
 *  - Fan-out to view calendars and Home Assistant webhook
 */

import { getAccessToken, SCOPES } from "./google-sa";

export type ChittyEventType =
  | `booking:${"airbnb" | "furnished_finder" | "vrbo" | "booking" | "direct"}`
  | `lease:${"move_in" | "move_out"}`
  | `maintenance:${"visit" | "reminder"}`
  | `inspection:${"move_in" | "move_out" | "periodic"}`
  | `rent:${"due" | "late"}`
  | "vrf:review"
  | `turnover:${"clean" | "restock"}`
  | "owner:block"
  | "access:smart_lock_code_rotate";

export type Audience = "tenant" | "owner" | "manager" | "vendor" | "cleaner" | "unit_echo";

export interface CalendarEnv {
  GOOGLE_SA_KEY: string;
  GOOGLE_SA_SUBJECT?: string;
  ICAL_SECRET: string;
}

export interface ChittyEvent {
  unitCalendarId: string; // resource email or calendar id
  unitId: string;
  propertyId: string;
  type: ChittyEventType;
  sourceId: string; // originating cr_* row id
  status: string;
  source: string; // 'chittyrental' | channel name
  title: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendees?: string[];
  assetId?: string;
}

function buildExtendedProperties(ev: ChittyEvent): Record<string, string> {
  const out: Record<string, string> = {
    "chitty.type": ev.type,
    "chitty.id": ev.sourceId,
    "chitty.unit_id": ev.unitId,
    "chitty.property_id": ev.propertyId,
    "chitty.status": ev.status,
    "chitty.source": ev.source,
  };
  if (ev.assetId) out["chitty.asset_id"] = ev.assetId;
  return out;
}

/** Upsert an event keyed by (chitty.type, chitty.id). */
export async function upsertEvent(
  env: CalendarEnv,
  ev: ChittyEvent
): Promise<{ id: string; htmlLink?: string }> {
  const token = await getAccessToken(env, [SCOPES.CALENDAR]);
  const calId = encodeURIComponent(ev.unitCalendarId);

  // Look for existing event with matching extendedProperties.private.chitty.id + chitty.type
  const search = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events?privateExtendedProperty=chitty.id=${encodeURIComponent(
      ev.sourceId
    )}&privateExtendedProperty=chitty.type=${encodeURIComponent(ev.type)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!search.ok) {
    throw new Error(`calendar search failed: ${search.status}`);
  }
  const searchBody = (await search.json()) as {
    items: Array<{ id: string; htmlLink?: string }>;
  };
  const existing = searchBody.items[0];

  const body = {
    summary: ev.title,
    description: ev.description ?? "",
    start: { dateTime: ev.startIso },
    end: { dateTime: ev.endIso },
    attendees: (ev.attendees ?? []).map((email) => ({ email })),
    extendedProperties: { private: buildExtendedProperties(ev) },
  };

  if (existing) {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calId}/events/${existing.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new Error(`calendar patch failed: ${res.status}`);
    return (await res.json()) as { id: string; htmlLink?: string };
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`calendar insert failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; htmlLink?: string };
}

export async function deleteEvent(
  env: CalendarEnv,
  unitCalendarId: string,
  eventId: string
): Promise<void> {
  const token = await getAccessToken(env, [SCOPES.CALENDAR]);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      unitCalendarId
    )}/events/${eventId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok && res.status !== 410) {
    throw new Error(`calendar delete failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// iCal pull (external channel → unit calendar)
// ---------------------------------------------------------------------------

export interface IcalEvent {
  uid: string;
  start: string; // ISO
  end: string; // ISO
  summary: string;
}

/** Minimal iCal VEVENT parser — enough for channel busy blocks. */
export function parseIcal(body: string): IcalEvent[] {
  const unfolded = body.replace(/\r?\n[ \t]/g, ""); // RFC5545 line unfolding
  const events: IcalEvent[] = [];
  const blocks = unfolded.split(/BEGIN:VEVENT/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split(/END:VEVENT/)[0];
    const uid = /UID:(.+?)\r?\n/.exec(block)?.[1]?.trim() ?? "";
    const start = /DTSTART(?:;[^:]+)?:(.+?)\r?\n/.exec(block)?.[1]?.trim() ?? "";
    const end = /DTEND(?:;[^:]+)?:(.+?)\r?\n/.exec(block)?.[1]?.trim() ?? "";
    const summary = /SUMMARY:(.+?)\r?\n/.exec(block)?.[1]?.trim() ?? "";
    if (uid && start && end) {
      events.push({
        uid,
        start: toIso(start),
        end: toIso(end),
        summary,
      });
    }
  }
  return events;
}

function toIso(v: string): string {
  // Handles basic forms: YYYYMMDD, YYYYMMDDTHHMMSSZ, YYYYMMDDTHHMMSS
  if (/^\d{8}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`;
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ""}`;
  }
  return v;
}

export async function pullIcal(url: string): Promise<IcalEvent[]> {
  const res = await fetch(url, { cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error(`ical pull failed: ${res.status}`);
  return parseIcal(await res.text());
}

// ---------------------------------------------------------------------------
// iCal export (unit calendar → signed public feed)
// ---------------------------------------------------------------------------

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export async function signIcalUrl(
  base: string,
  unitId: string,
  secret: string
): Promise<string> {
  const sig = await hmacSha256Hex(secret, unitId);
  return `${base.replace(/\/$/, "")}/api/gam/ical/export/${unitId}.ics?sig=${sig}`;
}

export async function verifyIcalSig(
  unitId: string,
  sig: string,
  secret: string
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, unitId);
  return timingSafeEqual(expected, sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export interface BusyBlock {
  uid: string;
  start: string;
  end: string;
  summary: string;
}

export function renderIcal(
  unitId: string,
  blocks: BusyBlock[]
): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ChittyRental//Unit Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:ChittyRental Unit ${unitId}`,
    "X-WR-TIMEZONE:UTC",
  ];
  for (const b of blocks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${toIcsTime(b.start)}`,
      `DTEND:${toIcsTime(b.end)}`,
      `SUMMARY:${b.summary.replace(/\r?\n/g, " ")}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function toIcsTime(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// ---------------------------------------------------------------------------
// Fan-out webhook (opt-in)
// ---------------------------------------------------------------------------

export interface FanoutPayload {
  unit_id: string;
  type: ChittyEventType;
  title: string;
  body: string;
  audiences: Audience[];
  scheduled_for?: string;
}

export async function forwardToHomeAssistant(
  webhookUrl: string | null,
  payload: FanoutPayload
): Promise<void> {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // fire-and-forget — failures are logged elsewhere, not fatal to sync
  });
}
