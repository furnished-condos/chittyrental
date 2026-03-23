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
import wizard from "./routes/wizard";

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
    SERVICE_NAME: string;
    RENTAL_CACHE: KVNamespace;
  };
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<AppEnv>();

// CORS
app.use(
  "/api/*",
  cors({
    origin: [
      "https://rental.chitty.cc",
      "https://app.rental.chitty.cc",
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
app.route("/api/wizard", wizard);

export default app;
