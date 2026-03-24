import { Hono } from "hono";
import { eq, and, desc, sql, between } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crTransactions, crProperties } from "../db/schema";

const app = new Hono<AppEnv>();

// List transactions, filter by property_id, type, category, date range
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.query("property_id");
  const type = c.req.query("type");
  const category = c.req.query("category");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [];
  if (propertyId) conditions.push(eq(crTransactions.property_id, propertyId));
  if (type) conditions.push(eq(crTransactions.type, type));
  if (category) conditions.push(eq(crTransactions.category, category));
  if (from && to) conditions.push(between(crTransactions.date, from, to));

  let query = db.select().from(crTransactions);
  if (conditions.length === 1) {
    query = query.where(conditions[0]) as typeof query;
  } else if (conditions.length > 1) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query.orderBy(desc(crTransactions.date));
  return c.json({ transactions: rows, count: rows.length });
});

// Get single transaction
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(crTransactions)
    .where(eq(crTransactions.id, c.req.param("id")));

  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// Create transaction
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json();
  const [row] = await db.insert(crTransactions).values(body).returning();
  return c.json(row, 201);
});

// Update transaction
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json();
  const [row] = await db
    .update(crTransactions)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crTransactions.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

// Delete transaction
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [row] = await db
    .delete(crTransactions)
    .where(eq(crTransactions.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ deleted: true });
});

// Summary: income vs expense by property
app.get("/summary/by-property", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [];
  if (from && to) conditions.push(between(crTransactions.date, from, to));

  const rows = await db
    .select({
      property_id: crTransactions.property_id,
      property_name: crProperties.name,
      type: crTransactions.type,
      total: sql<string>`sum(${crTransactions.amount}::numeric)`,
      count: sql<number>`count(*)`,
    })
    .from(crTransactions)
    .leftJoin(crProperties, eq(crTransactions.property_id, crProperties.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(crTransactions.property_id, crProperties.name, crTransactions.type);

  return c.json({ summary: rows });
});

export default app;
