/**
 * Inventory sheet pull + reconciliation against cr_assets.
 */

import { getAccessToken, SCOPES } from "./google-sa";
import {
  INVENTORY_CONSUMABLES_MAPPING,
  INVENTORY_MASTER_MAPPING,
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
  mapping: InventoryMapping
): Promise<unknown[][]> {
  const token = await getAccessToken(env, [SCOPES.SHEETS_RO]);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.INVENTORY_SHEET_ID}/values/${encodeURIComponent(mapping.range)}`;
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

export async function pullMaster(env: InventoryEnv): Promise<Record<string, unknown>[]> {
  const rows = await getRange(env, INVENTORY_MASTER_MAPPING);
  return rows.map((r) => projectRow(r, INVENTORY_MASTER_MAPPING));
}

export async function pullConsumables(env: InventoryEnv): Promise<Record<string, unknown>[]> {
  const rows = await getRange(env, INVENTORY_CONSUMABLES_MAPPING);
  return rows.map((r) => projectRow(r, INVENTORY_CONSUMABLES_MAPPING));
}
