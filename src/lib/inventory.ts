/**
 * Inventory sheet pull.
 *
 * Reads the configured tab range (header row + data rows), builds a
 * header-name index, and projects each data row through the mapping.
 * Tolerates schema growth: new columns added to the sheet light up
 * automatically as long as their header text matches one of the
 * `INVENTORY_MASTER_MAPPING.headers` entries.
 */

import { getAccessToken, SCOPES } from "./google-sa";
import {
  INVENTORY_MASTER_MAPPING,
  buildHeaderIndex,
  projectRow,
  type InventoryMapping,
} from "./inventory-mapping";

export interface InventoryEnv {
  GOOGLE_SA_KEY: string;
  GOOGLE_SA_SUBJECT?: string;
  INVENTORY_SHEET_ID: string;
}

async function getRange(
  env: InventoryEnv,
  range: string
): Promise<unknown[][]> {
  const token = await getAccessToken(env, [SCOPES.SHEETS_RO]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.INVENTORY_SHEET_ID}/values/${encodeURIComponent(range)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`sheets get failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const body = (await res.json()) as { values?: unknown[][] };
  return body.values ?? [];
}

async function pullByMapping(
  env: InventoryEnv,
  mapping: InventoryMapping
): Promise<Record<string, unknown>[]> {
  const rows = await getRange(env, mapping.range);
  if (rows.length === 0) return [];
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  return dataRows
    .filter((r) => r.length > 0 && r.some((c) => c !== "" && c != null))
    .map((r) => projectRow(r, mapping, headerIndex));
}

export async function pullMaster(
  env: InventoryEnv
): Promise<Record<string, unknown>[]> {
  return pullByMapping(env, INVENTORY_MASTER_MAPPING);
}
