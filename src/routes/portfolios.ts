import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crPortfolios, crProperties } from "../db/schema";

const app = new Hono<AppEnv>();

// List all portfolios with property count
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select({
      id: crPortfolios.id,
      name: crPortfolios.name,
      description: crPortfolios.description,
      gov_entity_id: crPortfolios.gov_entity_id,
      status: crPortfolios.status,
      created_at: crPortfolios.created_at,
      updated_at: crPortfolios.updated_at,
      property_count: sql<number>`count(${crProperties.id})::int`,
    })
    .from(crPortfolios)
    .leftJoin(crProperties, eq(crProperties.portfolio_id, crPortfolios.id))
    .groupBy(crPortfolios.id)
    .orderBy(crPortfolios.name);

  return c.json({ data: rows, count: rows.length });
});

// Get single portfolio
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [portfolio] = await db
    .select()
    .from(crPortfolios)
    .where(eq(crPortfolios.id, id))
    .limit(1);

  if (!portfolio) return c.json({ error: "Portfolio not found" }, 404);

  const properties = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.portfolio_id, id));

  return c.json({ data: { ...portfolio, properties } });
});

// Create portfolio
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    name: string;
    description?: string;
    gov_entity_id?: string;
    status?: string;
  }>();

  const [created] = await db
    .insert(crPortfolios)
    .values({
      name: body.name,
      description: body.description,
      gov_entity_id: body.gov_entity_id,
      status: body.status ?? "active",
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update portfolio
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    description?: string;
    gov_entity_id?: string;
    status?: string;
  }>();

  const [updated] = await db
    .update(crPortfolios)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crPortfolios.id, id))
    .returning();

  if (!updated) return c.json({ error: "Portfolio not found" }, 404);
  return c.json({ data: updated });
});

// Delete portfolio
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(crPortfolios)
    .where(eq(crPortfolios.id, id))
    .returning();

  if (!deleted) return c.json({ error: "Portfolio not found" }, 404);
  return c.json({ data: deleted });
});

export default app;
