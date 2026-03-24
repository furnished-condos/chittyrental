import { Hono } from "hono";
import { eq, or, ilike, isNull, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crTenants } from "../db/schema";

const VALID_STATUSES = [
  "prospect",
  "application",
  "screening",
  "approved",
  "active",
  "notice",
  "past",
  "rejected",
] as const;

const TRANSITIONS: Record<string, string[]> = {
  prospect: ["application", "rejected"],
  application: ["screening", "rejected"],
  screening: ["approved", "rejected"],
  approved: ["active", "rejected"],
  active: ["notice"],
  notice: ["past"],
  past: [],
  rejected: ["prospect"], // allow re-entry
};

const app = new Hono<AppEnv>();

// List tenants (excludes soft-deleted), search by email/name
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const search = c.req.query("search");
  const status = c.req.query("status");

  let query = db
    .select()
    .from(crTenants)
    .where(isNull(crTenants.deleted_at))
    .orderBy(desc(crTenants.created_at))
    .$dynamic();

  if (search) {
    query = query.where(
      or(
        ilike(crTenants.email, `%${search}%`),
        ilike(crTenants.first_name, `%${search}%`),
        ilike(crTenants.last_name, `%${search}%`)
      )
    );
  }

  if (status) {
    query = query.where(eq(crTenants.status, status));
  }

  const rows = await query;
  return c.json({ data: rows, count: rows.length });
});

// Get single tenant
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [tenant] = await db
    .select()
    .from(crTenants)
    .where(eq(crTenants.id, id))
    .limit(1);

  if (!tenant) return c.json({ error: "Tenant not found" }, 404);
  if (tenant.deleted_at) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ data: tenant });
});

// Create tenant
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
    status?: string;
    source?: string;
  }>();

  const [created] = await db
    .insert(crTenants)
    .values({
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone,
      status: body.status ?? "prospect",
      source: body.source,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update tenant
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<{
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    source?: string;
  }>();

  const [updated] = await db
    .update(crTenants)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crTenants.id, id))
    .returning();

  if (!updated) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ data: updated });
});

// Status transition
app.post("/:id/status", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const { status: newStatus } = await c.req.json<{ status: string }>();

  if (!VALID_STATUSES.includes(newStatus as (typeof VALID_STATUSES)[number])) {
    return c.json({ error: `Invalid status: ${newStatus}` }, 400);
  }

  const [tenant] = await db
    .select()
    .from(crTenants)
    .where(eq(crTenants.id, id))
    .limit(1);

  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  const allowed = TRANSITIONS[tenant.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return c.json(
      {
        error: `Cannot transition from '${tenant.status}' to '${newStatus}'. Allowed: ${allowed.join(", ") || "none"}`,
      },
      400
    );
  }

  const [updated] = await db
    .update(crTenants)
    .set({ status: newStatus, updated_at: new Date() })
    .where(eq(crTenants.id, id))
    .returning();

  return c.json({ data: updated });
});

// Soft-delete tenant (GDPR)
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [updated] = await db
    .update(crTenants)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(eq(crTenants.id, id))
    .returning();

  if (!updated) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ data: { id: updated.id, deleted_at: updated.deleted_at } });
});

export default app;
