/**
 * Google Sheet → cr_assets mapping.
 *
 * TODO(operator): confirm the real tab names and column letters against
 * the inventory sheet (1Zsu533Uy498ekbXdWpMuw8xIPAl5MCjf7mxFYkznyWI). These
 * are the assumed values from docs/gam-inventory-lifecycle.md §"Sheet schema".
 *
 * Columns are 0-indexed after `spreadsheets.values.get` returns them.
 */

export interface SheetColumnMap {
  [cr_field: string]: number; // 0-indexed column in the row array
}

export interface InventoryMapping {
  /** Tab (sheet) name */
  tab: string;
  /** Range A1 notation for the data rows (header excluded) */
  range: string;
  /** header-index mapping */
  columns: SheetColumnMap;
}

export const INVENTORY_MASTER_MAPPING: InventoryMapping = {
  tab: "Master",
  range: "Master!A2:R",
  columns: {
    external_id: 0, // A
    property_ref: 1, // B — property name/slug
    unit_ref: 2, // C — unit_number within property
    name: 3, // D
    asset_type: 4, // E
    model: 5, // F
    serial_number: 6, // G
    vendor: 7, // H
    purchase_date: 8, // I
    purchase_price: 9, // J
    warranty_expiration: 10, // K
    status: 11, // L
    location_notes: 12, // M
    receipt_url: 13, // N
    replacement_cost: 14, // O
    life_years: 15, // P
    last_service_date: 16, // Q
    service_interval_days: 17, // R
  },
};

export const INVENTORY_CONSUMABLES_MAPPING: InventoryMapping = {
  tab: "Consumables",
  range: "Consumables!A2:G",
  columns: {
    property_ref: 0,
    name: 1,
    current_qty: 2,
    reorder_threshold: 3,
    vendor: 4,
    last_restocked: 5,
    unit_price: 6,
  },
};

/** Map a sheet status value to a cr_assets lifecycle state. */
export const STATUS_MAP: Record<string, string> = {
  planned: "planned",
  ordered: "ordered",
  received: "received",
  deployed: "active",
  active: "active",
  "in-use": "active",
  repair: "repair",
  missing: "missing",
  "end-of-life": "end_of_life",
  retired: "retired",
  sold: "sold",
  "written-off": "written_off",
};

export function normalizeStatus(raw: unknown): string {
  if (typeof raw !== "string") return "active";
  return STATUS_MAP[raw.trim().toLowerCase()] ?? "active";
}

/** Project a row (array of cell values) through a mapping. */
export function projectRow(
  row: unknown[],
  mapping: InventoryMapping
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, idx] of Object.entries(mapping.columns)) {
    out[field] = row[idx] ?? null;
  }
  if ("status" in out) out.status = normalizeStatus(out.status);
  return out;
}
