/**
 * Public read-only surface for Chico KB, furnished-condos.com, and other
 * downstream consumers. All endpoints are unauthenticated; sensitive fields
 * (tenant PII, service-account IDs, raw email addresses) are projected away.
 *
 * Mounted at `/api/public` **before** the Bearer-token middleware in
 * src/index.ts. CORS is handled independently there with a broader allowlist.
 */

import { Hono } from "hono";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import {
  crLeases,
  crMaintenance,
  crPortfolios,
  crProperties,
  crUnits,
} from "../db/schema";
import { slug } from "../lib/gam";
import { CHANNEL_CATALOG, resolvePropertyChannels } from "../lib/channels";
import { CHITTY_CANON } from "../lib/chittyschema";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Property = typeof crProperties.$inferSelect;
type Unit = typeof crUnits.$inferSelect;
type Portfolio = typeof crPortfolios.$inferSelect;

interface PublicUnit {
  id: string;
  property_id: string;
  unit_number: string;
  bedrooms: number | null;
  bathrooms: string | null;
  sqft: number | null;
  floor: number | null;
  status: string;
}

interface PublicProperty {
  id: string;
  portfolio_id: string | null;
  portfolio_name: string | null;
  name: string;
  slug: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  property_type: string;
  status: string;
  jurisdiction: string | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: string | null;
  sqft: number | null;
  amenities: unknown;
  images: unknown;
  rent_amount: string | null;
  rent_currency: string;
  channels: ReturnType<typeof resolvePropertyChannels>;
  units: PublicUnit[];
}

function toPublicUnit(u: Unit): PublicUnit {
  return {
    id: u.id,
    property_id: u.property_id,
    unit_number: u.unit_number,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    sqft: u.sqft,
    floor: u.floor,
    status: u.status,
  };
}

function toPublicProperty(
  prop: Property,
  units: Unit[],
  portfolioName: string | null
): PublicProperty {
  return {
    id: prop.id,
    portfolio_id: prop.portfolio_id ?? null,
    portfolio_name: portfolioName,
    name: prop.name,
    slug: slug(prop.name),
    address: prop.address,
    city: prop.city,
    state: prop.state,
    zip: prop.zip,
    property_type: prop.property_type,
    status: prop.status,
    jurisdiction: prop.jurisdiction,
    description: prop.description,
    bedrooms: prop.bedrooms,
    bathrooms: prop.bathrooms,
    sqft: prop.sqft,
    amenities: prop.amenities,
    images: prop.images,
    rent_amount: prop.rent_amount,
    rent_currency: prop.rent_currency,
    channels: resolvePropertyChannels({
      id: prop.id,
      airbnb_id: prop.airbnb_id,
      furnished_finder_id: prop.furnished_finder_id,
      booking_id: prop.booking_id,
      zillow_id: prop.zillow_id,
      apartments_id: prop.apartments_id,
      metadata: prop.metadata as Record<string, unknown> | null,
    }),
    units: units.map(toPublicUnit),
  };
}

// ---------------------------------------------------------------------------
// /properties
// ---------------------------------------------------------------------------

app.get("/properties", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [props, units, portfolios] = await Promise.all([
    db.select().from(crProperties),
    db.select().from(crUnits),
    db.select().from(crPortfolios),
  ]);
  const portfolioName = new Map<string, string>(
    (portfolios as Portfolio[]).map((p) => [p.id, p.name])
  );
  const unitsByProperty = new Map<string, Unit[]>();
  for (const u of units as Unit[]) {
    const arr = unitsByProperty.get(u.property_id) ?? [];
    arr.push(u);
    unitsByProperty.set(u.property_id, arr);
  }
  const data = (props as Property[])
    .filter((p) => p.status !== "inactive")
    .map((p) =>
      toPublicProperty(
        p,
        unitsByProperty.get(p.id) ?? [],
        p.portfolio_id ? portfolioName.get(p.portfolio_id) ?? null : null
      )
    );
  return c.json({
    canon: CHITTY_CANON.service,
    generated_at: new Date().toISOString(),
    count: data.length,
    data,
  });
});

app.get("/properties/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json({ error: "id must be a UUID" }, 400);
  }
  const [prop] = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.id, id))
    .limit(1);
  if (!prop || prop.status === "inactive") {
    return c.json({ error: "property not found" }, 404);
  }
  const [units, portfolioRow] = await Promise.all([
    db.select().from(crUnits).where(eq(crUnits.property_id, id)),
    prop.portfolio_id
      ? db
          .select()
          .from(crPortfolios)
          .where(eq(crPortfolios.id, prop.portfolio_id))
          .limit(1)
      : Promise.resolve([] as Portfolio[]),
  ]);
  const portfolio = (portfolioRow as Portfolio[])[0];
  return c.json({
    canon: CHITTY_CANON.service,
    data: toPublicProperty(
      prop as Property,
      units as Unit[],
      portfolio?.name ?? null
    ),
  });
});

// ---------------------------------------------------------------------------
// /units
// ---------------------------------------------------------------------------

app.get("/units/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json({ error: "id must be a UUID" }, 400);
  }
  const [unit] = await db.select().from(crUnits).where(eq(crUnits.id, id)).limit(1);
  if (!unit) return c.json({ error: "unit not found" }, 404);
  const [prop] = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.id, unit.property_id))
    .limit(1);
  if (!prop || prop.status === "inactive") {
    return c.json({ error: "unit not found" }, 404);
  }
  return c.json({
    canon: CHITTY_CANON.service,
    data: {
      unit: toPublicUnit(unit as Unit),
      property: {
        id: prop.id,
        name: prop.name,
        slug: slug(prop.name),
        city: prop.city,
        state: prop.state,
      },
    },
  });
});

// ---------------------------------------------------------------------------
// /availability/:unitId — busy windows only, no PII
// ---------------------------------------------------------------------------

interface BusyWindow {
  start: string; // ISO date
  end: string;   // ISO date
  reason: "lease" | "maintenance" | "block";
}

app.get("/availability/:unitId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const unitId = c.req.param("unitId");
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) {
    return c.json({ error: "unitId must be a UUID" }, 400);
  }

  const from = c.req.query("from");
  const to = c.req.query("to");
  const fromDate = from ?? new Date().toISOString().slice(0, 10);
  const defaultTo = new Date();
  defaultTo.setDate(defaultTo.getDate() + 180);
  const toDate = to ?? defaultTo.toISOString().slice(0, 10);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
  ) {
    return c.json({ error: "from/to must be YYYY-MM-DD" }, 400);
  }

  const [unit] = await db.select().from(crUnits).where(eq(crUnits.id, unitId)).limit(1);
  if (!unit) return c.json({ error: "unit not found" }, 404);

  const [leases, maintenance] = await Promise.all([
    db
      .select({
        start_date: crLeases.start_date,
        end_date: crLeases.end_date,
        status: crLeases.status,
      })
      .from(crLeases)
      .where(
        and(
          eq(crLeases.unit_id, unitId),
          inArray(crLeases.status, ["active", "notice", "pending_signature"]),
          lte(crLeases.start_date, toDate),
        )
      ),
    db
      .select({
        created_at: crMaintenance.created_at,
        status: crMaintenance.status,
      })
      .from(crMaintenance)
      .where(
        and(
          eq(crMaintenance.unit_id, unitId),
          inArray(crMaintenance.status, ["in_progress", "pending_parts"]),
          gte(crMaintenance.created_at, new Date(fromDate)),
        )
      ),
  ]);

  const busy: BusyWindow[] = [];
  for (const l of leases as Array<{
    start_date: string;
    end_date: string | null;
    status: string;
  }>) {
    if (l.end_date && l.end_date < fromDate) continue;
    busy.push({
      start: l.start_date < fromDate ? fromDate : l.start_date,
      end: l.end_date ?? toDate,
      reason: "lease",
    });
  }
  for (const m of maintenance as Array<{
    created_at: Date;
    status: string;
  }>) {
    const start = m.created_at.toISOString().slice(0, 10);
    // Maintenance windows don't have explicit end; use a conservative 1-day.
    const d = new Date(m.created_at);
    d.setDate(d.getDate() + 1);
    busy.push({
      start,
      end: d.toISOString().slice(0, 10),
      reason: "maintenance",
    });
  }

  busy.sort((a, b) => a.start.localeCompare(b.start));

  return c.json({
    canon: CHITTY_CANON.service,
    data: {
      unit_id: unitId,
      from: fromDate,
      to: toDate,
      busy,
    },
  });
});

// ---------------------------------------------------------------------------
// /channels
// ---------------------------------------------------------------------------

app.get("/channels", (c) => {
  const data = Object.values(CHANNEL_CATALOG).map((ch) => ({
    id: ch.id,
    label: ch.label,
    has_ical_template: Boolean(ch.icalTemplate),
    legacy_column: ch.column ?? null,
  }));
  return c.json({ canon: CHITTY_CANON.channelCatalog, data });
});

// ---------------------------------------------------------------------------
// /mcp/manifest — read-only tool catalog for Chico KB and other MCP consumers
// ---------------------------------------------------------------------------

app.get("/mcp/manifest", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    schema_version: "2025-06-18",
    service: {
      name: "chittyrental",
      canon: CHITTY_CANON.service,
      base_url: `${origin}/api/public`,
      description:
        "ChittyRental public read-only surface: properties, units, availability, channels.",
      related: {
        chittycommand_home:
          "https://www.notion.so/ChittyCommand-Home-31794de43579817da6c7da9728ac8e22",
        chittyschema_registry: "chittycanon://core/services/chittyschema",
        mcp_gateway: "https://mcp.ch1tty.com",
        public_brand: "https://ch1tty.com",
      },
    },
    tools: [
      {
        name: "properties.list",
        description: "List all active properties with nested units and channel listings.",
        method: "GET",
        path: "/properties",
        canon: CHITTY_CANON.service,
      },
      {
        name: "properties.get",
        description: "Get a single property by UUID.",
        method: "GET",
        path: "/properties/{id}",
        parameters: { id: { type: "string", format: "uuid", required: true } },
      },
      {
        name: "units.get",
        description: "Get a single unit by UUID (includes short property context).",
        method: "GET",
        path: "/units/{id}",
        parameters: { id: { type: "string", format: "uuid", required: true } },
      },
      {
        name: "availability.get",
        description:
          "Busy windows for a unit over a date range. No PII; reasons limited to lease/maintenance/block.",
        method: "GET",
        path: "/availability/{unitId}",
        parameters: {
          unitId: { type: "string", format: "uuid", required: true },
          from: {
            type: "string",
            format: "date",
            required: false,
            description: "YYYY-MM-DD, defaults to today",
          },
          to: {
            type: "string",
            format: "date",
            required: false,
            description: "YYYY-MM-DD, defaults to today + 180 days",
          },
        },
      },
      {
        name: "channels.list",
        description: "List the booking/distribution channels ChittyRental understands.",
        method: "GET",
        path: "/channels",
        canon: CHITTY_CANON.channelCatalog,
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// /health — service-status ping for uptime monitors
// ---------------------------------------------------------------------------

app.get("/health", (c) =>
  c.json({ status: "ok", canon: CHITTY_CANON.service })
);

export default app;
