import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crMaintenance } from "../db/schema";

const app = new Hono<AppEnv>();

// List work orders, filter by property_id / status / priority
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.query("property_id");
  const status = c.req.query("status");
  const priority = c.req.query("priority");

  const conditions = [];
  if (propertyId) conditions.push(eq(crMaintenance.property_id, propertyId));
  if (status) conditions.push(eq(crMaintenance.status, status));
  if (priority) conditions.push(eq(crMaintenance.priority, priority));

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(crMaintenance)
          .where(and(...conditions))
          .orderBy(desc(crMaintenance.created_at))
      : await db
          .select()
          .from(crMaintenance)
          .orderBy(desc(crMaintenance.created_at));

  return c.json({ data: rows, count: rows.length });
});

// Get single work order
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [order] = await db
    .select()
    .from(crMaintenance)
    .where(eq(crMaintenance.id, id))
    .limit(1);

  if (!order) return c.json({ error: "Work order not found" }, 404);
  return c.json({ data: order });
});

// Create work order
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    property_id: string;
    unit_id?: string;
    reported_by?: string;
    assigned_to?: string;
    title: string;
    description?: string;
    priority?: string;
    status?: string;
    cost_estimate?: string;
    photos?: unknown;
    entry_notice?: unknown;
  }>();

  const [created] = await db
    .insert(crMaintenance)
    .values({
      property_id: body.property_id,
      unit_id: body.unit_id,
      reported_by: body.reported_by,
      assigned_to: body.assigned_to,
      title: body.title,
      description: body.description,
      priority: body.priority ?? "medium",
      status: body.status ?? "open",
      cost_estimate: body.cost_estimate,
      photos: body.photos,
      entry_notice: body.entry_notice,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update work order (including assign vendor)
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<{
    assigned_to?: string;
    title?: string;
    description?: string;
    priority?: string;
    status?: string;
    cost_estimate?: string;
    cost_actual?: string;
    photos?: unknown;
    entry_notice?: unknown;
  }>();

  const [updated] = await db
    .update(crMaintenance)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crMaintenance.id, id))
    .returning();

  if (!updated) return c.json({ error: "Work order not found" }, 404);
  return c.json({ data: updated });
});

export default app;
