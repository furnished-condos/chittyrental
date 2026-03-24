import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crProperties, crUnits } from "../db/schema";

const app = new Hono<AppEnv>();

// List all properties with unit count
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const portfolioId = c.req.query("portfolio_id");

  const query = db
    .select({
      id: crProperties.id,
      portfolio_id: crProperties.portfolio_id,
      name: crProperties.name,
      address: crProperties.address,
      city: crProperties.city,
      state: crProperties.state,
      zip: crProperties.zip,
      property_type: crProperties.property_type,
      status: crProperties.status,
      jurisdiction: crProperties.jurisdiction,
      bedrooms: crProperties.bedrooms,
      bathrooms: crProperties.bathrooms,
      sqft: crProperties.sqft,
      gov_asset_id: crProperties.gov_asset_id,
      cf_property_id: crProperties.cf_property_id,
      created_at: crProperties.created_at,
      updated_at: crProperties.updated_at,
      unit_count: sql<number>`count(${crUnits.id})::int`,
    })
    .from(crProperties)
    .leftJoin(crUnits, eq(crUnits.property_id, crProperties.id))
    .groupBy(crProperties.id)
    .orderBy(crProperties.name);

  const rows = portfolioId
    ? await query.where(eq(crProperties.portfolio_id, portfolioId))
    : await query;

  return c.json({ data: rows, count: rows.length });
});

// Get single property with units
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [property] = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.id, id))
    .limit(1);

  if (!property) return c.json({ error: "Property not found" }, 404);

  const units = await db
    .select()
    .from(crUnits)
    .where(eq(crUnits.property_id, id));

  return c.json({ data: { ...property, units } });
});

// Create property
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    portfolio_id?: string;
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    property_type: string;
    status?: string;
    jurisdiction?: string;
    airbnb_id?: string;
    furnished_finder_id?: string;
    zillow_id?: string;
    bedrooms?: number;
    bathrooms?: string;
    sqft?: number;
    amenities?: unknown;
    images?: unknown;
    gov_asset_id?: string;
    gov_entity_id?: string;
    cf_property_id?: string;
  }>();

  // gov_entity_id is not a column on cr_properties — strip it before insert
  const { gov_entity_id: _govEntityId, ...insertData } = body;

  const [created] = await db
    .insert(crProperties)
    .values({
      ...insertData,
      status: body.status ?? "setup",
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update property
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();

  const [updated] = await db
    .update(crProperties)
    .set({ ...(body as Record<string, string>), updated_at: new Date() })
    .where(eq(crProperties.id, id))
    .returning();

  if (!updated) return c.json({ error: "Property not found" }, 404);
  return c.json({ data: updated });
});

// Delete property
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(crProperties)
    .where(eq(crProperties.id, id))
    .returning();

  if (!deleted) return c.json({ error: "Property not found" }, 404);
  return c.json({ data: deleted });
});

// Platform sync stub — triggers external platform sync
app.post("/:id/sync", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env.DATABASE_URL);

  const [property] = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.id, id))
    .limit(1);

  if (!property) return c.json({ error: "Property not found" }, 404);

  // TODO: dispatch sync to Airbnb/Furnished Finder/Zillow via ChittyScrape
  return c.json({
    data: {
      property_id: id,
      platforms: {
        airbnb: property.airbnb_id ? "queued" : "not_linked",
        furnished_finder: property.furnished_finder_id ? "queued" : "not_linked",
        zillow: property.zillow_id ? "queued" : "not_linked",
      },
    },
  });
});

export default app;
