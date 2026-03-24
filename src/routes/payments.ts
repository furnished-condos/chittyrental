import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crPayments, crTenants } from "../db/schema";

const app = new Hono<AppEnv>();

// List payments, filter by tenant_id or lease_id or status
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const tenantId = c.req.query("tenant_id");
  const leaseId = c.req.query("lease_id");
  const status = c.req.query("status");

  const conditions = [];
  if (tenantId) conditions.push(eq(crPayments.tenant_id, tenantId));
  if (leaseId) conditions.push(eq(crPayments.lease_id, leaseId));
  if (status) conditions.push(eq(crPayments.status, status));

  let query = db
    .select({
      payment: crPayments,
      tenant_name: crTenants.first_name,
      tenant_last: crTenants.last_name,
    })
    .from(crPayments)
    .leftJoin(crTenants, eq(crPayments.tenant_id, crTenants.id));

  if (conditions.length === 1) {
    query = query.where(conditions[0]) as typeof query;
  } else if (conditions.length > 1) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query.orderBy(desc(crPayments.created_at));
  return c.json({
    payments: rows.map((r) => ({
      ...r.payment,
      tenant: r.tenant_name ? `${r.tenant_name} ${r.tenant_last}` : null,
    })),
    count: rows.length,
  });
});

// Get single payment
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(crPayments)
    .where(eq(crPayments.id, c.req.param("id")));

  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// Create payment
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json();
  const [row] = await db.insert(crPayments).values(body).returning();
  return c.json(row, 201);
});

// Mark payment as completed
app.post("/:id/complete", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [row] = await db
    .update(crPayments)
    .set({ status: "completed", paid_at: new Date(), updated_at: new Date() })
    .where(eq(crPayments.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

// Mark payment as failed
app.post("/:id/fail", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [row] = await db
    .update(crPayments)
    .set({ status: "failed", updated_at: new Date() })
    .where(eq(crPayments.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

export default app;
