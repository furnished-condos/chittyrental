import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crVrfLedger } from "../db/schema";

const app = new Hono<AppEnv>();

// List all VRF entries (optionally filter by property_id query param)
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.query("property_id");

  const rows = propertyId
    ? await db
        .select()
        .from(crVrfLedger)
        .where(eq(crVrfLedger.property_id, propertyId))
        .orderBy(desc(crVrfLedger.period))
    : await db
        .select()
        .from(crVrfLedger)
        .orderBy(desc(crVrfLedger.period));

  return c.json({ data: rows, count: rows.length });
});

// VRF history for a specific property
app.get("/property/:propertyId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.param("propertyId");

  const rows = await db
    .select()
    .from(crVrfLedger)
    .where(eq(crVrfLedger.property_id, propertyId))
    .orderBy(desc(crVrfLedger.period));

  return c.json({ data: rows, count: rows.length });
});

// Latest VRF period for a property
app.get("/property/:propertyId/current", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.param("propertyId");

  const [current] = await db
    .select()
    .from(crVrfLedger)
    .where(eq(crVrfLedger.property_id, propertyId))
    .orderBy(desc(crVrfLedger.period))
    .limit(1);

  if (!current)
    return c.json({ error: "No VRF entries for this property" }, 404);

  return c.json({ data: current });
});

// Create VRF entry
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    property_id: string;
    period: string;
    opening_balance?: string;
    contributions?: string;
    withdrawals?: string;
    closing_balance?: string;
    target_cap?: string;
    status?: string;
  }>();

  const [created] = await db
    .insert(crVrfLedger)
    .values({
      property_id: body.property_id,
      period: body.period,
      opening_balance: body.opening_balance ?? "0",
      contributions: body.contributions ?? "0",
      withdrawals: body.withdrawals ?? "0",
      closing_balance: body.closing_balance ?? "0",
      target_cap: body.target_cap,
      status: body.status ?? "funded",
    })
    .returning();

  return c.json({ data: created }, 201);
});

export default app;
