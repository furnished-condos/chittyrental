/**
 * Google Sheet → cr_assets mapping.
 *
 * The inventory sheet starts as a simple "what's at the property" roster
 * (Location / Item Category / Item Description / Quantity / Condition /
 * Brand-Model) and grows into a richer schedule as operators add columns
 * for purchase data, warranty, service intervals, etc. Mapping is by
 * **header name** rather than fixed column letter, so adding a column to
 * the sheet automatically lights it up here without code changes; absent
 * columns simply produce `null` cells.
 *
 * Today the live sheet (Global tab) has only the six "starting place"
 * headers below. Every aspirational header (Purchase Date, Purchase
 * Price, Warranty Until, etc.) is listed but optional — the sync
 * tolerates whichever subset exists.
 */

/** cr_field → expected sheet header text (case-insensitive match). */
export interface SheetHeaderMap {
  [cr_field: string]: string;
}

export interface InventoryMapping {
  /** Tab (sheet) name */
  tab: string;
  /** Range A1 notation including the header row at top — header row is
   *  read for column dispatch, data rows are projected. Use `:Z` (or
   *  similar wide range) so the read picks up future columns without
   *  another code change. */
  range: string;
  /** cr_field → header text. Lookup is case-insensitive + trimmed. */
  headers: SheetHeaderMap;
}

/**
 * Inventory roster mapping. The first six rows below are the headers
 * present in the current draft sheet ("starting place"). The rest are
 * the target schema operators can add over time; the sync recognizes
 * them automatically when they appear.
 */
export const INVENTORY_MASTER_MAPPING: InventoryMapping = {
  tab: "Global",
  range: "Global!A1:Z",
  headers: {
    // ---- starting-place columns (currently in the draft sheet) ------------
    location: "Location",                 // → cr_properties.name lookup
    item_category: "Item Category",       // → metadata.room (Bedroom/Kitchen/...)
    name: "Item Description",             // → cr_assets.name
    quantity: "Quantity",                 // → metadata.quantity (number or null)
    condition: "Condition",               // → metadata.condition (free text)
    model: "Brand/Model (Optional)",      // → cr_assets.model (raw)

    // ---- aspirational columns (target schema; absent today) ---------------
    asset_type: "Asset Type",             // → cr_assets.asset_type (operator override)
    serial_number: "Serial",              // → cr_assets.serial_number
    vendor: "Vendor",                     // → cr_assets.vendor
    purchase_date: "Purchase Date",       // → cr_assets.purchase_date (YYYY-MM-DD)
    purchase_price: "Purchase Price",     // → cr_assets.purchase_price (decimal)
    warranty_expiration: "Warranty Until",// → cr_assets.warranty_expiration
    status: "Status",                     // → cr_assets.status (lifecycle)
    location_notes: "Location Notes",     // → metadata.location_notes
    receipt_url: "Receipt URL",           // → metadata.receipt_url
    replacement_cost: "Replacement Cost", // → metadata.replacement_cost
    life_years: "Life Years",             // → metadata.life_years (depreciation)
    last_service_date: "Last Service",    // → metadata.last_service_date
    service_interval_days: "Service Interval (days)", // → metadata.service_interval_days
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
  // Canonicalize separators so both `end_of_life` (matches the cr_assets
  // status enum form) and `end-of-life` (the STATUS_MAP key form) map.
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return STATUS_MAP[key] ?? "active";
}

/** Fields that live inside cr_assets.metadata JSONB rather than as
 *  top-level columns. */
const METADATA_FIELDS = new Set([
  "item_category",
  "quantity",
  "condition",
  "location_notes",
  "receipt_url",
  "replacement_cost",
  "life_years",
  "last_service_date",
  "service_interval_days",
]);

/** Renames applied when projecting from cr_field to the metadata key.
 *  Keeps the mapping config natural (e.g. matches the sheet header
 *  `Item Category`) while the persisted shape uses the documented key
 *  (`metadata.room`). */
const METADATA_KEY_RENAME: Record<string, string> = {
  item_category: "room",
};

/** Reference fields that point at other cr_* tables; resolved by caller. */
const REF_FIELDS = new Set(["location"]);

/**
 * Coarse asset_type derivation from the description text + room category,
 * used when the sheet doesn't have an explicit "Asset Type" column. Each
 * value matches one of the lifecycle defaults in
 * `src/lib/depreciation.ts:DEFAULT_LIFE_YEARS`. Operators can override
 * by adding an "Asset Type" column to the sheet.
 */
export function deriveAssetType(
  description: string | null | undefined,
  itemCategory: string | null | undefined
): string {
  const d = (description ?? "").toLowerCase();
  const cat = (itemCategory ?? "").toLowerCase();
  if (/\b(tv|alexa|appletv|streaming|sonos|soundbar|speaker|wifi|router)\b/.test(d)) return "electronics";
  if (/\b(washer|dryer|fridge|refrigerator|range|stove|microwave|dishwasher|oven|food processor|emulsifier|mixer|vacuum|vaccum)\b/.test(d)) return "appliance";
  if (/\b(a\/c|hvac|air condition|heater|furnace)\b/.test(d)) return "hvac";
  if (/\b(toilet|sink|faucet|shower|tub|bidet)\b/.test(d)) return "fixture";
  if (/\b(rug|curtain|blanket|towel|throw|pillow|quilt|sheet)\b/.test(d)) return "soft_goods";
  if (/\b(diffuser|connected|smart)\b/.test(d)) return "smart_home";
  if (/\b(sofa|chair|table|dresser|credenza|nightstand|bed|bench|stool|cart|barcart|mattress|ottoman|sectional|desk|shelf|shelving)\b/.test(d)) return "furniture";
  if (cat === "bathroom" && /\b(towel|wash|cloth|bath)\b/.test(d)) return "soft_goods";
  return "other";
}

/** Parse a Quantity cell. Empty / "~" / non-numeric → null. */
function parseQuantity(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === "~") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a (lowercased) header → column-index map from the sheet's first
 * row. Returns null when the header row is missing.
 */
export function buildHeaderIndex(headerRow: unknown[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    if (typeof h === "string") {
      idx[h.trim().toLowerCase()] = i;
    }
  });
  return idx;
}

/**
 * Project a single data row through the mapping using the resolved
 * header index. Unknown / missing columns yield `null`. Top-level
 * cr_assets fields go on the row root; metadata-destined fields nest
 * under `metadata`; lookups (Location → property_id) go to `_refs`.
 */
export function projectRow(
  row: unknown[],
  mapping: InventoryMapping,
  headerIndex: Record<string, number>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  const refs: Record<string, unknown> = {};

  for (const [crField, headerText] of Object.entries(mapping.headers)) {
    const colIdx = headerIndex[headerText.trim().toLowerCase()];
    let value: unknown = null;
    if (colIdx !== undefined) {
      const cell = row[colIdx];
      value =
        cell === undefined || cell === "" ? null : cell;
    }
    if (REF_FIELDS.has(crField)) {
      refs[crField] = value;
    } else if (METADATA_FIELDS.has(crField)) {
      const metaKey = METADATA_KEY_RENAME[crField] ?? crField;
      metadata[metaKey] = value;
    } else {
      out[crField] = value;
    }
  }

  // Quantity is metadata-side; coerce to number where possible.
  if ("quantity" in metadata) {
    metadata.quantity = parseQuantity(metadata.quantity);
  }

  // status normalization (only if the sheet has a Status column populated)
  if ("status" in out && out.status != null) {
    out.status = normalizeStatus(out.status);
  } else {
    // The starting-place sheet has no Status column; default deployed
    // assets to "active". Operators can override by adding the column.
    out.status = "active";
  }

  // Derive asset_type when the sheet doesn't supply one. `metadata.room`
  // is what `Item Category` lands at after the metadata-key rename.
  if (!out.asset_type) {
    out.asset_type = deriveAssetType(
      typeof out.name === "string" ? out.name : null,
      typeof metadata.room === "string" ? metadata.room : null
    );
  }

  if (Object.keys(metadata).length) out.metadata = metadata;
  if (Object.keys(refs).length) out._refs = refs;
  return out;
}
