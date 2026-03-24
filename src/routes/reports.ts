import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import { crFinancialReports } from "../db/schema";

const app = new Hono<AppEnv>();

// List reports, filter by property_id or report_type
app.get("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const propertyId = c.req.query("property_id");
  const reportType = c.req.query("type");

  let query = db.select().from(crFinancialReports);
  if (propertyId) {
    query = query.where(eq(crFinancialReports.property_id, propertyId)) as typeof query;
  } else if (reportType) {
    query = query.where(eq(crFinancialReports.report_type, reportType)) as typeof query;
  }

  const rows = await query.orderBy(desc(crFinancialReports.end_date));
  return c.json({ reports: rows, count: rows.length });
});

// Get single report
app.get("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const rows = await db
    .select()
    .from(crFinancialReports)
    .where(eq(crFinancialReports.id, c.req.param("id")));

  if (rows.length === 0) return c.json({ error: "not found" }, 404);
  return c.json(rows[0]);
});

// Create report
app.post("/", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json();
  const [row] = await db.insert(crFinancialReports).values(body).returning();
  return c.json(row, 201);
});

// Update report (e.g. add AI insights)
app.put("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json();
  const [row] = await db
    .update(crFinancialReports)
    .set({ ...body, updated_at: new Date() })
    .where(eq(crFinancialReports.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

// Delete report
app.delete("/:id", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const [row] = await db
    .delete(crFinancialReports)
    .where(eq(crFinancialReports.id, c.req.param("id")))
    .returning();

  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ deleted: true });
});

export default app;
