import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crUnits } from "../db/schema";

const app = new Hono<AppEnv>();

// List units — optionally scoped to property_id
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.query("property_id");

  const rows = propertyId
    ? await db
        .select()
        .from(crUnits)
        .where(eq(crUnits.property_id, propertyId))
        .orderBy(crUnits.unit_number)
    : await db.select().from(crUnits).orderBy(crUnits.unit_number);

  return c.json({ data: rows, count: rows.length });
});

// Get single unit
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [unit] = await db
    .select()
    .from(crUnits)
    .where(eq(crUnits.id, id))
    .limit(1);

  if (!unit) return c.json({ error: "Unit not found" }, 404);
  return c.json({ data: unit });
});

// Create unit
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    property_id: string;
    unit_number: string;
    bedrooms?: number;
    bathrooms?: string;
    sqft?: number;
    floor?: number;
    status?: string;
  }>();

  const [created] = await db
    .insert(crUnits)
    .values({
      property_id: body.property_id,
      unit_number: body.unit_number,
      bedrooms: body.bedrooms,
      bathrooms: body.bathrooms,
      sqft: body.sqft,
      floor: body.floor,
      status: body.status ?? "available",
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update unit
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<{
    unit_number?: string;
    bedrooms?: number;
    bathrooms?: string;
    sqft?: number;
    floor?: number;
    status?: string;
  }>();

  const [updated] = await db
    .update(crUnits)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crUnits.id, id))
    .returning();

  if (!updated) return c.json({ error: "Unit not found" }, 404);
  return c.json({ data: updated });
});

// Delete unit
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(crUnits)
    .where(eq(crUnits.id, id))
    .returning();

  if (!deleted) return c.json({ error: "Unit not found" }, 404);
  return c.json({ data: deleted });
});

export default app;
