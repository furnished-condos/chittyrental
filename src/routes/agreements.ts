import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crAgreements } from "../db/schema";

const app = new Hono<AppEnv>();

// List agreements, filter by agreement_type and jurisdiction
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const agreementType = c.req.query("agreement_type");
  const jurisdiction = c.req.query("jurisdiction");

  const conditions = [];
  if (agreementType) conditions.push(eq(crAgreements.agreement_type, agreementType));
  if (jurisdiction) conditions.push(eq(crAgreements.jurisdiction, jurisdiction));

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(crAgreements)
          .where(and(...conditions))
          .orderBy(desc(crAgreements.created_at))
      : await db
          .select()
          .from(crAgreements)
          .orderBy(desc(crAgreements.created_at));

  return c.json({ data: rows, count: rows.length });
});

// Get single agreement
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [agreement] = await db
    .select()
    .from(crAgreements)
    .where(eq(crAgreements.id, id))
    .limit(1);

  if (!agreement) return c.json({ error: "Agreement not found" }, 404);
  return c.json({ data: agreement });
});

// Create agreement
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    name: string;
    description?: string;
    agreement_type: string;
    jurisdiction?: string;
    rules?: unknown;
    version?: number;
    effective_from?: string;
    effective_to?: string;
  }>();

  const [created] = await db
    .insert(crAgreements)
    .values({
      name: body.name,
      description: body.description,
      agreement_type: body.agreement_type,
      jurisdiction: body.jurisdiction,
      rules: body.rules,
      version: body.version ?? 1,
      effective_from: body.effective_from,
      effective_to: body.effective_to,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update agreement
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    description?: string;
    agreement_type?: string;
    jurisdiction?: string;
    rules?: unknown;
    version?: number;
    effective_from?: string;
    effective_to?: string;
  }>();

  const [updated] = await db
    .update(crAgreements)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crAgreements.id, id))
    .returning();

  if (!updated) return c.json({ error: "Agreement not found" }, 404);
  return c.json({ data: updated });
});

// Delete agreement
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(crAgreements)
    .where(eq(crAgreements.id, id))
    .returning();

  if (!deleted) return c.json({ error: "Agreement not found" }, 404);
  return c.json({ data: deleted });
});

export default app;
