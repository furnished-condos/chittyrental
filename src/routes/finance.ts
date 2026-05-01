import { Hono } from "hono";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import {
  previewDepreciation,
  previousPeriod,
  runDepreciation,
} from "../lib/depreciation";

const app = new Hono<AppEnv>();

/**
 * Manual trigger for the monthly depreciation pass. The same entry point is
 * used by the scheduled cron in src/index.ts.
 *
 * Query params:
 *   period  — YYYY-MM, defaults to the previous calendar month
 *   dry_run — "false" to actually write/forward; default true
 */
app.post("/depreciation/run", async (c) => {
  const period = c.req.query("period") ?? previousPeriod();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return c.json({ error: "period must be YYYY-MM" }, 400);
  }
  const dryRun = c.req.query("dry_run") !== "false";
  const db = getDb(c.env.DATABASE_URL);
  try {
    const result = await runDepreciation(c.env, db, period, dryRun);
    return c.json({ data: result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

/**
 * Read-only preview of the depreciation pass. Pure compute — does not
 * write to cr_financial_reports, cr_sync_log, or ChittyFinance. Useful
 * for dashboards that want to show "what would the numbers look like
 * for X". For an audited dry-run that DOES log, call POST /run with
 * `?dry_run=true`.
 */
app.get("/depreciation/preview", async (c) => {
  const period = c.req.query("period") ?? previousPeriod();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return c.json({ error: "period must be YYYY-MM" }, 400);
  }
  const db = getDb(c.env.DATABASE_URL);
  try {
    const result = await previewDepreciation(c.env, db, period);
    return c.json({ data: result });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
