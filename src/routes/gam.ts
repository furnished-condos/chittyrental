import { Hono } from "hono";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { AppEnv } from "../index";
import { getDb } from "../db";
import {
  crLeases,
  crPortfolios,
  crProperties,
  crSyncLog,
  crTenants,
  crUnits,
} from "../db/schema";
import {
  buildDesiredState,
  buildingsToCsv,
  groupsToCsv,
  ousToCsv,
  reconcileResources,
  resourcesToCsv,
  retirePlan,
  slug,
} from "../lib/gam";
import { configStatus as notionStatus, fetchProperties as fetchNotionProperties } from "../lib/notion";
import { pullMaster, pullConsumables } from "../lib/inventory";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

app.get("/status", (c) => {
  return c.json({
    data: {
      notion: notionStatus(c.env),
      google_sa_configured: Boolean(c.env.GOOGLE_SA_KEY),
      inventory_sheet_id: c.env.INVENTORY_SHEET_ID ? "set" : "unset",
      ical_secret_configured: Boolean(c.env.ICAL_SECRET),
    },
  });
});

// ---------------------------------------------------------------------------
// Desired state
// ---------------------------------------------------------------------------

app.get("/desired-state", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const state = await buildDesiredState(db);
  return c.json({ data: state });
});

app.get("/desired-state/ous.csv", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const state = await buildDesiredState(db);
  return new Response(ousToCsv(state), {
    headers: { "Content-Type": "text/csv" },
  });
});

app.get("/desired-state/groups.csv", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const state = await buildDesiredState(db);
  return new Response(groupsToCsv(state), {
    headers: { "Content-Type": "text/csv" },
  });
});

app.get("/desired-state/resources.csv", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const state = await buildDesiredState(db);
  return new Response(resourcesToCsv(state), {
    headers: { "Content-Type": "text/csv" },
  });
});

app.get("/desired-state/buildings.csv", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const state = await buildDesiredState(db);
  return new Response(buildingsToCsv(state), {
    headers: { "Content-Type": "text/csv" },
  });
});

app.get("/desired-state/drives.json", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const state = await buildDesiredState(db);
  return c.json(state.drives);
});

// `gam update group ... sync members file <path>` expects a headerless,
// single-column list of email addresses — one per line. We return emails that
// we can derive today; groups whose membership requires ChittyGov (owners,
// vendors) return an empty body so the runner skips the sync (see
// scripts/gam/bootstrap-groups.sh).
app.get("/desired-state/group-members.csv", async (c) => {
  const group = c.req.query("group") ?? "";
  const db = getDb(c.env.DATABASE_URL);
  const emails = await groupMemberEmails(db, group);
  const body = emails.length ? emails.join("\n") + "\n" : "";
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
});

async function groupMemberEmails(
  db: ReturnType<typeof getDb>,
  group: string
): Promise<string[]> {
  // Group emails are `{scope}-{role}@chitty.cc`. Scope is either:
  //   - a portfolio slug (owners/managers/vendors), or
  //   - `{portfolioSlug}-{propertySlug}` (tenants/managers of a property).
  const m = /^([a-z0-9-]+)-(tenants|managers|owners|vendors)@/.exec(group);
  if (!m) return [];
  const [, scope, role] = m;

  if (role === "tenants" || (role === "managers" && scope.includes("-"))) {
    // Property-scoped group. Match scope against every `{portfolio}-{property}`
    // pair rather than trying to split on `-` (both slugs can contain dashes).
    const portfolios = await db
      .select({ id: crPortfolios.id, name: crPortfolios.name })
      .from(crPortfolios);
    const props = await db
      .select({
        id: crProperties.id,
        name: crProperties.name,
        portfolio_id: crProperties.portfolio_id,
      })
      .from(crProperties);
    const portfolioSlug = new Map<string, string>(
      portfolios.map((p: { id: string; name: string }) => [p.id, slug(p.name)])
    );
    const propIds = props
      .filter(
        (p: { id: string; name: string; portfolio_id: string | null }) => {
          const pslug = p.portfolio_id
            ? portfolioSlug.get(p.portfolio_id)
            : undefined;
          const fq = pslug ? `${pslug}-${slug(p.name)}` : slug(p.name);
          return fq === scope;
        }
      )
      .map(
        (p: { id: string; name: string; portfolio_id: string | null }) => p.id
      );
    if (propIds.length === 0) return [];
    if (role !== "tenants") {
      // TODO: resolve property managers (needs ChittyGov / staff directory).
      return [];
    }
    const units = await db
      .select({ id: crUnits.id })
      .from(crUnits)
      .where(inArray(crUnits.property_id, propIds));
    const unitIds = units.map((u: { id: string }) => u.id);
    if (unitIds.length === 0) return [];
    const rows = await db
      .select({ email: crTenants.email })
      .from(crLeases)
      .innerJoin(crTenants, eq(crLeases.tenant_id, crTenants.id))
      .where(
        and(
          inArray(crLeases.unit_id, unitIds),
          eq(crLeases.status, "active"),
          isNotNull(crTenants.email)
        )
      );
    const seen = new Set<string>();
    for (const r of rows as Array<{ email: string | null }>) {
      if (r.email) seen.add(r.email.trim().toLowerCase());
    }
    return [...seen].sort();
  }

  // TODO: wire portfolio-level owners/managers/vendors once ChittyGov
  // exposes entity members (gov_entity_id → email list). Returning empty
  // means the runner leaves existing memberships untouched rather than
  // emptying the group.
  return [];
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

app.post("/reconcile", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const form = await c.req.formData();
  const resourcesCsv = await (form.get("resources") as File | null)?.text();
  if (!resourcesCsv) return c.json({ error: "resources CSV missing" }, 400);

  const state = await buildDesiredState(db);
  const report = reconcileResources(state.resources, resourcesCsv);

  const [log] = await db
    .insert(crSyncLog)
    .values({
      source: "gam",
      sync_type: "resources",
      direction: "inbound",
      status: "completed",
      records_synced:
        report.missing_in_gam.length + report.orphan_in_gam.length + report.drifted.length,
      error_message:
        report.missing_in_gam.length ||
        report.drifted.length ||
        report.orphan_in_gam.length
          ? `missing:${report.missing_in_gam.length} orphan:${report.orphan_in_gam.length} drifted:${report.drifted.length}`
          : null,
      completed_at: new Date(),
    })
    .returning();

  return c.json({ data: { report, log_id: log.id } });
});

// ---------------------------------------------------------------------------
// Sync log endpoint (called by shell scripts)
// ---------------------------------------------------------------------------

app.post("/log", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const body = await c.req.json<{
    sync_type: string;
    direction: string;
    status: string;
    records_synced?: number;
    error_message?: string;
  }>();
  const [log] = await db
    .insert(crSyncLog)
    .values({
      source: "gam",
      sync_type: body.sync_type,
      direction: body.direction,
      status: body.status,
      records_synced: body.records_synced ?? null,
      error_message: body.error_message ?? null,
      completed_at: body.status === "completed" ? new Date() : null,
    })
    .returning();
  return c.json({ data: log }, 201);
});

// ---------------------------------------------------------------------------
// Drive / retire callbacks
// ---------------------------------------------------------------------------

app.post("/drive-provisioned", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { property_id, shared_drive_id } = await c.req.json<{
    property_id: string;
    shared_drive_id: string;
  }>();
  const [prop] = await db
    .select()
    .from(crProperties)
    .where(eq(crProperties.id, property_id))
    .limit(1);
  if (!prop) return c.json({ error: "property not found" }, 404);

  const meta = (prop.metadata as Record<string, unknown> | null) ?? {};
  meta.shared_drive_id = shared_drive_id;
  const [updated] = await db
    .update(crProperties)
    .set({ metadata: meta, updated_at: new Date() })
    .where(eq(crProperties.id, property_id))
    .returning();
  return c.json({ data: updated });
});

app.get("/retire-plan/:propertyId", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const plan = await retirePlan(db, c.req.param("propertyId"));
  if (!plan) return c.json({ error: "property not found" }, 404);
  return c.json(plan);
});

app.post("/retired", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  const { property_id, retired_at } = await c.req.json<{
    property_id: string;
    retired_at?: string;
  }>();
  if (!property_id || !/^[0-9a-f-]{36}$/i.test(property_id)) {
    return c.json({ error: "property_id must be a UUID" }, 400);
  }
  const retiredAt = retired_at ? new Date(retired_at) : new Date();
  if (Number.isNaN(retiredAt.getTime())) {
    return c.json({ error: "retired_at must be a valid ISO timestamp" }, 400);
  }
  const [updated] = await db
    .update(crProperties)
    .set({ status: "inactive", updated_at: retiredAt })
    .where(eq(crProperties.id, property_id))
    .returning();
  if (!updated) return c.json({ error: "property not found" }, 404);
  return c.json({ data: updated });
});

// ---------------------------------------------------------------------------
// Notion sync
// ---------------------------------------------------------------------------

app.post("/sync-notion", async (c) => {
  const db = getDb(c.env.DATABASE_URL);

  try {
    const rows = await fetchNotionProperties(c.env);
    // Discovery mode only: operator must fill src/lib/notion-mapping.ts with
    // real Notion property IDs before enabling writes.
    await db.insert(crSyncLog).values({
      source: "notion",
      sync_type: "properties",
      direction: "inbound",
      status: "completed",
      records_synced: rows.length,
      completed_at: new Date(),
    });
    return c.json({
      data: {
        dry_run: true, // forced until notion-mapping.ts is verified
        rows_discovered: rows.length,
        sample: rows.slice(0, 3),
      },
    });
  } catch (err) {
    await db.insert(crSyncLog).values({
      source: "notion",
      sync_type: "properties",
      direction: "inbound",
      status: "failed",
      error_message: String(err),
      completed_at: new Date(),
    });
    return c.json({ error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Inventory sync
// ---------------------------------------------------------------------------

app.post("/inventory/sync", async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  if (!c.env.GOOGLE_SA_KEY || !c.env.INVENTORY_SHEET_ID) {
    return c.json({ error: "GOOGLE_SA_KEY / INVENTORY_SHEET_ID not set" }, 400);
  }
  try {
    const [master, consumables] = await Promise.all([
      pullMaster({
        GOOGLE_SA_KEY: c.env.GOOGLE_SA_KEY,
        GOOGLE_SA_SUBJECT: c.env.GOOGLE_SA_SUBJECT,
        INVENTORY_SHEET_ID: c.env.INVENTORY_SHEET_ID,
      }),
      pullConsumables({
        GOOGLE_SA_KEY: c.env.GOOGLE_SA_KEY,
        GOOGLE_SA_SUBJECT: c.env.GOOGLE_SA_SUBJECT,
        INVENTORY_SHEET_ID: c.env.INVENTORY_SHEET_ID,
      }),
    ]);
    await db.insert(crSyncLog).values({
      source: "sheets",
      sync_type: "inventory",
      direction: "inbound",
      status: "completed",
      records_synced: master.length + consumables.length,
      completed_at: new Date(),
    });
    return c.json({
      data: {
        master_rows: master.length,
        consumable_rows: consumables.length,
        dry_run: true, // always dry-run until mapping is verified
        sample_master: master.slice(0, 3),
        sample_consumables: consumables.slice(0, 3),
      },
    });
  } catch (err) {
    await db.insert(crSyncLog).values({
      source: "sheets",
      sync_type: "inventory",
      direction: "inbound",
      status: "failed",
      error_message: String(err),
      completed_at: new Date(),
    });
    return c.json({ error: String(err) }, 500);
  }
});

export default app;
