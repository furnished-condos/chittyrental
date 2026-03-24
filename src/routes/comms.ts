import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crComms, crTenants } from "../db/schema";

const app = new Hono<AppEnv>();

// List comms, filter by tenant_id, property_id, channel
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const tenantId = c.req.query("tenant_id");
  const propertyId = c.req.query("property_id");
  const channel = c.req.query("channel");

  const conditions = [];
  if (tenantId) conditions.push(eq(crComms.tenant_id, tenantId));
  if (propertyId) conditions.push(eq(crComms.property_id, propertyId));
  if (channel) conditions.push(eq(crComms.channel, channel));

  let query = db
    .select({
      comm: crComms,
      tenant_name: crTenants.first_name,
      tenant_last: crTenants.last_name,
    })
    .from(crComms)
    .leftJoin(crTenants, eq(crComms.tenant_id, crTenants.id));

  if (conditions.length === 1) {
    query = query.where(conditions[0]) as typeof query;
  } else if (conditions.length > 1) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = await query.orderBy(desc(crComms.occurred_at));
  return c.json({
    comms: rows.map((r) => ({
      ...r.comm,
      tenant: r.tenant_name ? `${r.tenant_name} ${r.tenant_last}` : null,
    })),
    count: rows.length,
  });
});

// Get single comm
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(crComms)
    .where(eq(crComms.id, c.req.param("id")));

  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// Log a communication
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json();
  const [row] = await db.insert(crComms).values(body).returning();
  return c.json(row, 201);
});

// Delete comm
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [row] = await db
    .delete(crComms)
    .where(eq(crComms.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ deleted: true });
});

export default app;
