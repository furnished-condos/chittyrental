import { Hono } from "hono";
import { cors } from "hono/cors";
import portfolios from "./routes/portfolios";
import properties from "./routes/properties";
import units from "./routes/units";
import tenants from "./routes/tenants";
import leases from "./routes/leases";
import agreements from "./routes/agreements";
import maintenance from "./routes/maintenance";
import vrf from "./routes/vrf";
import rent from "./routes/rent";
import transactions from "./routes/transactions";
import reports from "./routes/reports";
import payments from "./routes/payments";
import comms from "./routes/comms";
import wizard from "./routes/wizard";
import gam from "./routes/gam";
import calendar, { publicIcal } from "./routes/calendar";
import publicApi from "./routes/public";
import finance from "./routes/finance";
import { previousPeriod, runDepreciation } from "./lib/depreciation";
import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Environment bindings
// ---------------------------------------------------------------------------

export type AppEnv = {
  Bindings: {
    ENVIRONMENT: string;
    DATABASE_URL: string;
    CHITTY_AUTH_SERVICE_TOKEN: string;
    CHITTYFINANCE_URL: string;
    CHITTYGOV_URL: string;
    CHITTYCHARGE_URL: string;
    CHITTYCONNECT_URL: string;
    CHITTYSCHEMA_URL?: string;
    SERVICE_NAME: string;
    RENTAL_CACHE: KVNamespace;
    // Notion gateway (mcp.ch1tty.com or direct Notion API)
    NOTION_GATEWAY_URL?: string;
    NOTION_GATEWAY_TOKEN?: string;
    NOTION_DATABASE_ID?: string;
    NOTION_UNITS_DATABASE_ID?: string;
    NOTION_PORTFOLIOS_DATABASE_ID?: string;
    // Google service account (domain-wide delegated, base64 JSON)
    GOOGLE_SA_KEY?: string;
    GOOGLE_SA_SUBJECT?: string;
    // Inventory sheet
    INVENTORY_SHEET_ID?: string;
    // Calendar hub
    ICAL_SECRET?: string;
    // Gemini
    GEMINI_API_KEY?: string;
    GEMINI_MODEL?: string;
  };
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<AppEnv>();

// Public read-only surface — open CORS. Must be mounted BEFORE the
// /api/* Bearer middleware so it's reachable without a service token
// from Chico's KB, furnished-condos.com, and channel partners.
app.use(
  "/api/public/*",
  cors({
    origin: (origin) => origin, // reflect any origin; responses are public read-only
    allowMethods: ["GET", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 300,
  })
);
app.route("/api/public", publicApi);

// Internal CORS for authed /api/* routes — restricted allowlist.
app.use(
  "/api/*",
  cors({
    origin: [
      "https://rental.chitty.cc",
      "https://app.rental.chitty.cc",
      "https://rental.ch1tty.com",
      "https://app.ch1tty.com",
      "https://ch1tty.com",
      "http://localhost:5173",
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health — public, no auth
app.get("/health", (c) =>
  c.json({ status: "ok", service: "chittyrental" })
);

// Auth middleware for /api/* routes
app.use("/api/*", async (c, next) => {
  // /api/public/* is the unauthenticated read-only surface.
  if (c.req.path.startsWith("/api/public/")) {
    return next();
  }
  // Bypass auth in dev
  if (c.env.ENVIRONMENT !== "production") {
    return next();
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const token = authHeader.slice(7);
  if (token !== c.env.CHITTY_AUTH_SERVICE_TOKEN) {
    return c.json({ error: "invalid token" }, 403);
  }

  return next();
});

// Mount route groups
app.route("/api/portfolios", portfolios);
app.route("/api/properties", properties);
app.route("/api/units", units);
app.route("/api/tenants", tenants);
app.route("/api/leases", leases);
app.route("/api/agreements", agreements);
app.route("/api/maintenance", maintenance);
app.route("/api/vrf", vrf);
app.route("/api/rent", rent);
app.route("/api/transactions", transactions);
app.route("/api/reports", reports);
app.route("/api/payments", payments);
app.route("/api/comms", comms);
app.route("/api/wizard", wizard);
app.route("/api/gam", gam);
app.route("/api/calendar", calendar);
app.route("/api/finance", finance);

// Public signed iCal export (no auth — HMAC signature verified per request)
app.route("/ical", publicIcal);

// ---------------------------------------------------------------------------
// Scheduled handler — wrangler.toml `[triggers] crons` invokes this.
//
// Cron schedule => task:
//   "0 5 1 * *"  => depreciation pass for the previous calendar month.
//
// Cron-driven runs are real (dryRun=false). Operators can audit-log a
// dry-run via POST /api/finance/depreciation/run?dry_run=true, or get a
// pure-compute preview (no writes) via GET /api/finance/depreciation/preview.
// ---------------------------------------------------------------------------

/**
 * Handles scheduled cron triggers and, for the monthly depreciation cron,
 * schedules a depreciation run for the previous accounting period.
 *
 * When `controller.cron` equals `"0 5 1 * *"`, computes the previous period
 * from `controller.scheduledTime` and initiates `runDepreciation`
 * (dry run = `false`) via `ctx.waitUntil`; any errors from the depreciation
 * task are caught and logged.
 *
 * @param controller - The scheduled event controller containing the cron expression and scheduledTime
 * @param env - Environment bindings (service URLs, secrets, and KV namespaces)
 * @param ctx - Execution context used to extend worker lifetime with `waitUntil`
 */

async function scheduled(
  controller: ScheduledController,
  env: AppEnv["Bindings"],
  ctx: ExecutionContext
): Promise<void> {
  if (controller.cron === "0 5 1 * *") {
    const db = getDb(env.DATABASE_URL);
    const period = previousPeriod(new Date(controller.scheduledTime));
    ctx.waitUntil(
      runDepreciation(env, db, period, false).catch((err) => {
        console.error("depreciation cron failed", { period, err: String(err) });
      })
    );
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
