import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crLeases, crTenants, crUnits } from "../db/schema";

const TRANSITIONS: Record<string, string[]> = {
  draft: ["pending_signature"],
  pending_signature: ["active"],
  active: ["renewed", "notice"],
  renewed: ["active", "notice"],
  notice: ["expired", "terminated"],
  expired: [],
  terminated: [],
};

const app = new Hono<AppEnv>();

// List leases with tenant + unit info
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const status = c.req.query("status");
  const unitId = c.req.query("unit_id");
  const tenantId = c.req.query("tenant_id");

  let query = db
    .select({
      id: crLeases.id,
      unit_id: crLeases.unit_id,
      tenant_id: crLeases.tenant_id,
      lease_type: crLeases.lease_type,
      start_date: crLeases.start_date,
      end_date: crLeases.end_date,
      monthly_rent: crLeases.monthly_rent,
      currency: crLeases.currency,
      security_deposit: crLeases.security_deposit,
      security_deposit_status: crLeases.security_deposit_status,
      status: crLeases.status,
      agreement_id: crLeases.agreement_id,
      signed_doc_url: crLeases.signed_doc_url,
      created_at: crLeases.created_at,
      updated_at: crLeases.updated_at,
      tenant_first_name: crTenants.first_name,
      tenant_last_name: crTenants.last_name,
      tenant_email: crTenants.email,
      unit_number: crUnits.unit_number,
      property_id: crUnits.property_id,
    })
    .from(crLeases)
    .leftJoin(crTenants, eq(crTenants.id, crLeases.tenant_id))
    .leftJoin(crUnits, eq(crUnits.id, crLeases.unit_id))
    .orderBy(desc(crLeases.created_at))
    .$dynamic();

  if (status) query = query.where(eq(crLeases.status, status));
  if (unitId) query = query.where(eq(crLeases.unit_id, unitId));
  if (tenantId) query = query.where(eq(crLeases.tenant_id, tenantId));

  const rows = await query;
  return c.json({ data: rows, count: rows.length });
});

// Get single lease with tenant + unit
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [lease] = await db
    .select({
      id: crLeases.id,
      unit_id: crLeases.unit_id,
      tenant_id: crLeases.tenant_id,
      lease_type: crLeases.lease_type,
      start_date: crLeases.start_date,
      end_date: crLeases.end_date,
      monthly_rent: crLeases.monthly_rent,
      currency: crLeases.currency,
      security_deposit: crLeases.security_deposit,
      security_deposit_status: crLeases.security_deposit_status,
      status: crLeases.status,
      agreement_id: crLeases.agreement_id,
      signed_doc_url: crLeases.signed_doc_url,
      created_at: crLeases.created_at,
      updated_at: crLeases.updated_at,
      tenant_first_name: crTenants.first_name,
      tenant_last_name: crTenants.last_name,
      tenant_email: crTenants.email,
      unit_number: crUnits.unit_number,
      property_id: crUnits.property_id,
    })
    .from(crLeases)
    .leftJoin(crTenants, eq(crTenants.id, crLeases.tenant_id))
    .leftJoin(crUnits, eq(crUnits.id, crLeases.unit_id))
    .where(eq(crLeases.id, id))
    .limit(1);

  if (!lease) return c.json({ error: "Lease not found" }, 404);
  return c.json({ data: lease });
});

// Create lease
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    unit_id: string;
    tenant_id: string;
    lease_type: string;
    start_date: string;
    end_date?: string;
    monthly_rent: string;
    currency?: string;
    security_deposit?: string;
    security_deposit_status?: string;
    status?: string;
    agreement_id?: string;
  }>();

  const [created] = await db
    .insert(crLeases)
    .values({
      unit_id: body.unit_id,
      tenant_id: body.tenant_id,
      lease_type: body.lease_type,
      start_date: body.start_date,
      end_date: body.end_date,
      monthly_rent: body.monthly_rent,
      currency: body.currency ?? "USD",
      security_deposit: body.security_deposit,
      security_deposit_status: body.security_deposit_status,
      status: body.status ?? "draft",
      agreement_id: body.agreement_id,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Update lease
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();

  // Prevent direct status changes through update — use /status or /renew /terminate
  delete body.status;

  const [updated] = await db
    .update(crLeases)
    .set({ ...(body as Record<string, string>), updated_at: new Date() })
    .where(eq(crLeases.id, id))
    .returning();

  if (!updated) return c.json({ error: "Lease not found" }, 404);
  return c.json({ data: updated });
});

// Renew lease
app.post("/:id/renew", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json<{
    end_date?: string;
    monthly_rent?: string;
  }>();

  const [lease] = await db
    .select()
    .from(crLeases)
    .where(eq(crLeases.id, id))
    .limit(1);

  if (!lease) return c.json({ error: "Lease not found" }, 404);

  const allowed = TRANSITIONS[lease.status] ?? [];
  if (!allowed.includes("renewed")) {
    return c.json(
      { error: `Cannot renew lease in '${lease.status}' status` },
      400
    );
  }

  const [updated] = await db
    .update(crLeases)
    .set({
      status: "renewed",
      end_date: body.end_date ?? lease.end_date,
      monthly_rent: body.monthly_rent ?? lease.monthly_rent,
      updated_at: new Date(),
    })
    .where(eq(crLeases.id, id))
    .returning();

  return c.json({ data: updated });
});

// Terminate lease
app.post("/:id/terminate", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  const [lease] = await db
    .select()
    .from(crLeases)
    .where(eq(crLeases.id, id))
    .limit(1);

  if (!lease) return c.json({ error: "Lease not found" }, 404);

  const allowed = TRANSITIONS[lease.status] ?? [];
  if (!allowed.includes("terminated")) {
    return c.json(
      { error: `Cannot terminate lease in '${lease.status}' status` },
      400
    );
  }

  const [updated] = await db
    .update(crLeases)
    .set({ status: "terminated", updated_at: new Date() })
    .where(eq(crLeases.id, id))
    .returning();

  return c.json({ data: updated });
});

export default app;
