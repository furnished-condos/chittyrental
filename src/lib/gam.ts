/**
 * GAM desired-state builder + CSV emitters + reconcile diff.
 *
 * The Worker computes desired state from cr_* tables; GAM scripts pull
 * these CSVs and apply them. No GAM CLI runs inside the Worker.
 */

import type { Db } from "../db";
import { crPortfolios, crProperties, crUnits } from "../db/schema";
import { eq } from "drizzle-orm";

type Portfolio = typeof crPortfolios.$inferSelect;
type Property = typeof crProperties.$inferSelect;
type Unit = typeof crUnits.$inferSelect;

export interface DesiredOu {
  name: string;
  parentOrgUnitPath: string;
  description: string;
}

export interface DesiredGroup {
  email: string;
  name: string;
  description: string;
}

export interface DesiredResource {
  resourceId: string;
  resourceName: string;
  resourceEmail: string;
  resourceType: string;
  resourceCategory: string;
  resourceDescription: string; // carries `chitty:{cr_units.id}` marker
  buildingId: string;
  capacity: number;
  featureInstances: string; // semicolon-separated
  crUnitId: string;
}

export interface DesiredBuilding {
  buildingId: string;
  buildingName: string;
  description: string;
  floorNames: string;
  coordinates: string;
}

export interface DesiredDrive {
  property_id: string;
  drive_name: string;
  managers_group: string;
}

export interface DesiredState {
  ous: DesiredOu[];
  groups: DesiredGroup[];
  resources: DesiredResource[];
  buildings: DesiredBuilding[];
  drives: DesiredDrive[];
}

const ROOT_OU = "/ChittyRental";
const RESOURCE_DOMAIN = "resources.chitty.cc";

export function slug(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function short(uuid: string): string {
  return uuid.replace(/-/g, "").slice(0, 8);
}

export async function buildDesiredState(db: Db): Promise<DesiredState> {
  const portfolios = await db.select().from(crPortfolios);
  const properties = await db.select().from(crProperties);
  const units = await db.select().from(crUnits);

  const ous: DesiredOu[] = [];
  const groups: DesiredGroup[] = [];
  const resources: DesiredResource[] = [];
  const buildings: DesiredBuilding[] = [];
  const drives: DesiredDrive[] = [];

  for (const p of portfolios as Portfolio[]) {
    const pslug = slug(p.name);
    ous.push({
      name: pslug,
      parentOrgUnitPath: ROOT_OU,
      description: `Portfolio: ${p.name}`,
    });
    for (const role of ["owners", "managers", "vendors"] as const) {
      groups.push({
        email: `${pslug}-${role}@chitty.cc`,
        name: `${p.name} — ${role[0].toUpperCase() + role.slice(1)}`,
        description: `${role} group for ${p.name}`,
      });
    }
  }

  const portfolioById = new Map<string, Portfolio>(
    portfolios.map((p: Portfolio) => [p.id, p])
  );

  for (const prop of properties as Property[]) {
    if (prop.status === "inactive") continue;
    const portfolio = prop.portfolio_id ? portfolioById.get(prop.portfolio_id) : null;
    const portfolioSlug = portfolio ? slug(portfolio.name) : "unassigned";
    const propSlug = slug(prop.name);

    ous.push({
      name: propSlug,
      parentOrgUnitPath: `${ROOT_OU}/${portfolioSlug}`,
      description: `Property: ${prop.name}`,
    });

    for (const role of ["tenants", "managers"] as const) {
      groups.push({
        email: `${propSlug}-${role}@chitty.cc`,
        name: `${prop.name} — ${role[0].toUpperCase() + role.slice(1)}`,
        description: `${role} at ${prop.name}`,
      });
    }

    buildings.push({
      buildingId: propSlug,
      buildingName: prop.name,
      description: [prop.address, prop.city, prop.state, prop.zip]
        .filter(Boolean)
        .join(", "),
      floorNames: "1;2;3;",
      coordinates: "",
    });

    drives.push({
      property_id: prop.id,
      drive_name: `${portfolio?.name ?? "Unassigned"} — ${prop.name}`,
      managers_group: `${propSlug}-managers@chitty.cc`,
    });

    const propUnits = (units as Unit[]).filter((u) => u.property_id === prop.id);
    const featureInstances = Array.isArray(prop.amenities)
      ? (prop.amenities as string[]).join(";")
      : "";
    for (const unit of propUnits) {
      const uid8 = short(unit.id);
      const capacity = Math.max(2, (unit.bedrooms ?? 0) * 2);
      resources.push({
        resourceId: `cr-unit-${uid8}`,
        resourceName: `${prop.name} — ${unit.unit_number}`,
        resourceEmail: `unit-${uid8}@${RESOURCE_DOMAIN}`,
        resourceType: "Rental Unit",
        resourceCategory: "OTHER",
        resourceDescription: `chitty:${unit.id}`,
        buildingId: propSlug,
        capacity,
        featureInstances,
        crUnitId: unit.id,
      });
    }
  }

  return { ous, groups, resources, buildings, drives };
}

// ---------------------------------------------------------------------------
// CSV emitters (GAM-compatible)
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cols: unknown[]): string {
  return cols.map(csvCell).join(",");
}

export function ousToCsv(state: DesiredState): string {
  const header = ["name", "parentOrgUnitPath", "description"];
  const rows = state.ous.map((o) => csvRow([o.name, o.parentOrgUnitPath, o.description]));
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function groupsToCsv(state: DesiredState): string {
  const header = ["email", "name", "description"];
  const rows = state.groups.map((g) => csvRow([g.email, g.name, g.description]));
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function resourcesToCsv(state: DesiredState): string {
  const header = [
    "resourceId",
    "resourceName",
    "resourceEmail",
    "resourceType",
    "resourceCategory",
    "resourceDescription",
    "buildingId",
    "capacity",
    "featureInstances",
  ];
  const rows = state.resources.map((r) =>
    csvRow([
      r.resourceId,
      r.resourceName,
      r.resourceEmail,
      r.resourceType,
      r.resourceCategory,
      r.resourceDescription,
      r.buildingId,
      r.capacity,
      r.featureInstances,
    ])
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

export function buildingsToCsv(state: DesiredState): string {
  const header = ["buildingId", "buildingName", "description", "floorNames", "coordinates"];
  const rows = state.buildings.map((b) =>
    csvRow([b.buildingId, b.buildingName, b.description, b.floorNames, b.coordinates])
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Reconcile diff
// ---------------------------------------------------------------------------

export interface ReconcileReport {
  missing_in_gam: string[]; // resourceIds present in desired, absent in GAM
  orphan_in_gam: string[]; // resourceIds in GAM with no matching cr_units row
  drifted: Array<{ resourceId: string; field: string; desired: string; actual: string }>;
}

/**
 * Diff desired vs. actual resources.
 * `actualCsv` is a `gam print resources allfields` export.
 */
export function reconcileResources(
  desired: DesiredResource[],
  actualCsv: string
): ReconcileReport {
  const actualRows = parseCsv(actualCsv);
  const byId = new Map<string, Record<string, string>>();
  for (const row of actualRows) {
    if (row.resourceId) byId.set(row.resourceId, row);
  }
  const desiredById = new Map(desired.map((d) => [d.resourceId, d]));

  const report: ReconcileReport = {
    missing_in_gam: [],
    orphan_in_gam: [],
    drifted: [],
  };

  for (const d of desired) {
    const actual = byId.get(d.resourceId);
    if (!actual) {
      report.missing_in_gam.push(d.resourceId);
      continue;
    }
    for (const field of ["resourceName", "resourceEmail", "buildingId"] as const) {
      if (actual[field] && actual[field] !== String(d[field])) {
        report.drifted.push({
          resourceId: d.resourceId,
          field,
          desired: String(d[field]),
          actual: actual[field],
        });
      }
    }
  }
  for (const [id, actual] of byId) {
    if (!desiredById.has(id)) {
      // Only flag as orphan if it's in our managed domain
      if (actual.resourceDescription?.startsWith("chitty:")) {
        report.orphan_in_gam.push(id);
      }
    }
  }
  return report;
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Retire plan: what GAM should do to decommission a property.
 */
export async function retirePlan(
  db: Db,
  propertyId: string
): Promise<{
  ou_path: string;
  resources: string[];
  shared_drive_id: string | null;
  drive_name: string;
} | null> {
  const [prop] = await db.select().from(crProperties).where(eq(crProperties.id, propertyId)).limit(1);
  if (!prop) return null;
  const portfolio = prop.portfolio_id
    ? (await db.select().from(crPortfolios).where(eq(crPortfolios.id, prop.portfolio_id)))[0]
    : null;
  const portfolioSlug = portfolio ? slug(portfolio.name) : "unassigned";
  const propSlug = slug(prop.name);
  const units = await db.select().from(crUnits).where(eq(crUnits.property_id, prop.id));
  const meta = (prop as { metadata?: Record<string, unknown> }).metadata ?? {};
  return {
    ou_path: `${ROOT_OU}/${portfolioSlug}/${propSlug}`,
    resources: units.map((u: Unit) => `cr-unit-${short(u.id)}`),
    shared_drive_id:
      typeof meta.shared_drive_id === "string" ? (meta.shared_drive_id as string) : null,
    drive_name: `${portfolio?.name ?? "Unassigned"} — ${prop.name}`,
  };
}
