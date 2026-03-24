import { Hono } from "hono";
import { eq, and, lt, desc, sql } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crRentLedger, crLeases, crTenants, crUnits } from "../db/schema";

const app = new Hono<AppEnv>();

// List rent ledger entries, filter by lease_id
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const leaseId = c.req.query("lease_id");

  const rows = leaseId
    ? await db
        .select()
        .from(crRentLedger)
        .where(eq(crRentLedger.lease_id, leaseId))
        .orderBy(desc(crRentLedger.due_date))
    : await db
        .select()
        .from(crRentLedger)
        .orderBy(desc(crRentLedger.due_date));

  return c.json({ data: rows, count: rows.length });
});

// Overdue payments across all leases
app.get("/overdue", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: crRentLedger.id,
      lease_id: crRentLedger.lease_id,
      period_start: crRentLedger.period_start,
      period_end: crRentLedger.period_end,
      amount_due: crRentLedger.amount_due,
      amount_paid: crRentLedger.amount_paid,
      due_date: crRentLedger.due_date,
      status: crRentLedger.status,
      late_fee_applied: crRentLedger.late_fee_applied,
      tenant_first_name: crTenants.first_name,
      tenant_last_name: crTenants.last_name,
      unit_number: crUnits.unit_number,
      property_id: crUnits.property_id,
    })
    .from(crRentLedger)
    .leftJoin(crLeases, eq(crLeases.id, crRentLedger.lease_id))
    .leftJoin(crTenants, eq(crTenants.id, crLeases.tenant_id))
    .leftJoin(crUnits, eq(crUnits.id, crLeases.unit_id))
    .where(
      and(
        lt(crRentLedger.due_date, today),
        sql`${crRentLedger.status} IN ('due', 'partial', 'late')`
      )
    )
    .orderBy(crRentLedger.due_date);

  return c.json({ data: rows, count: rows.length });
});

// Get entries for a specific lease
app.get("/:leaseId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const leaseId = c.req.param("leaseId");

  const rows = await db
    .select()
    .from(crRentLedger)
    .where(eq(crRentLedger.lease_id, leaseId))
    .orderBy(desc(crRentLedger.due_date));

  return c.json({ data: rows, count: rows.length });
});

// Create rent ledger entry
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    lease_id: string;
    period_start: string;
    period_end: string;
    amount_due: string;
    due_date: string;
    amount_paid?: string;
    paid_date?: string;
    status?: string;
    cf_transaction_id?: string;
    charge_id?: string;
  }>();

  const [created] = await db
    .insert(crRentLedger)
    .values({
      lease_id: body.lease_id,
      period_start: body.period_start,
      period_end: body.period_end,
      amount_due: body.amount_due,
      due_date: body.due_date,
      amount_paid: body.amount_paid ?? "0",
      paid_date: body.paid_date,
      status: body.status ?? "due",
      cf_transaction_id: body.cf_transaction_id,
      charge_id: body.charge_id,
    })
    .returning();

  return c.json({ data: created }, 201);
});

// Record payment against a rent ledger entry
app.post("/record-payment", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    rent_ledger_id: string;
    amount: string;
    paid_date?: string;
    cf_transaction_id?: string;
    charge_id?: string;
  }>();

  const [entry] = await db
    .select()
    .from(crRentLedger)
    .where(eq(crRentLedger.id, body.rent_ledger_id))
    .limit(1);

  if (!entry) return c.json({ error: "Rent ledger entry not found" }, 404);

  const newPaid =
    parseFloat(entry.amount_paid) + parseFloat(body.amount);
  const amountDue = parseFloat(entry.amount_due);
  const newStatus =
    newPaid >= amountDue ? "paid" : newPaid > 0 ? "partial" : entry.status;

  const [updated] = await db
    .update(crRentLedger)
    .set({
      amount_paid: newPaid.toFixed(2),
      paid_date: body.paid_date ?? new Date().toISOString().slice(0, 10),
      status: newStatus,
      cf_transaction_id: body.cf_transaction_id ?? entry.cf_transaction_id,
      charge_id: body.charge_id ?? entry.charge_id,
      updated_at: new Date(),
    })
    .where(eq(crRentLedger.id, body.rent_ledger_id))
    .returning();

  return c.json({ data: updated });
});

export default app;
