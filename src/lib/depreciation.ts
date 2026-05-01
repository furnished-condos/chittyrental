/**
 * Straight-line depreciation pass for cr_assets.
 *
 * Runs monthly via the scheduled handler in src/index.ts (or on-demand via
 * /api/finance/depreciation/run). For each active asset with a purchase_date
 * + purchase_price, computes a per-month depreciation entry; the per-property
 * roll-up is persisted to cr_financial_reports (report_type='depreciation')
 * and individual entries are forwarded to ChittyFinance via financeClient.
 *
 * Reuse points:
 *   - financeClient(env)    src/lib/clients.ts
 *   - crAssets / crFinancialReports / crSyncLog  src/db/schema.ts
 */

import { and, isNotNull, lte } from "drizzle-orm";
import type { Db } from "../db";
import { crAssets, crFinancialReports, crSyncLog } from "../db/schema";
import { financeClient } from "./clients";

type Asset = typeof crAssets.$inferSelect;

/**
 * Default useful-life in years per asset_type when the asset's
 * `metadata.life_years` isn't set. Tuned to common landlord write-down
 * conventions; tweak in one place rather than scattering through callers.
 */
export const DEFAULT_LIFE_YEARS: Record<string, number> = {
  appliance: 7,
  furniture: 5,
  electronics: 3,
  hvac: 15,
  flooring: 10,
  window_treatment: 5,
  smart_home: 5,
  fixture: 10,
  other: 7,
};

const FALLBACK_LIFE_YEARS = 7;

export interface DepreciationEntry {
  asset_id: string;
  property_id: string;
  unit_id: string | null;
  asset_name: string;
  asset_type: string;
  period: string; // 'YYYY-MM'
  monthly_amount: number;
  cumulative_amount: number;
  remaining_book_value: number;
  life_years: number;
  purchase_date: string;
  purchase_price: number;
}

export interface PropertyRollup {
  property_id: string;
  period: string;
  total_monthly: number;
  total_cumulative: number;
  total_remaining_book_value: number;
  entries: DepreciationEntry[];
  by_asset_type: Record<string, number>;
}

export interface RunResult {
  period: string;
  dry_run: boolean;
  properties: number;
  entries: number;
  total_amount: number;
  finance_forwarded: number;
  finance_skipped: number;
  reports_written: number;
}

/**
 * Compute the inclusive start and end dates for a month specified as `YYYY-MM`.
 *
 * @param period - Month in `YYYY-MM` format
 * @returns An object with `start` set to the month's first day and `end` set to the month's last day, both in `YYYY-MM-DD` format
 * @throws Error if `period` is not a valid `YYYY-MM` string
 */
export function periodBounds(period: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new Error(`invalid period: ${period} (expected YYYY-MM)`);
  }
  const [y, m] = period.split("-").map(Number);
  const start = `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-01`;
  // Last day of month: day 0 of next month in JS Date arithmetic.
  const last = new Date(Date.UTC(y, m, 0));
  const end = `${last.getUTCFullYear()}-${(last.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${last.getUTCDate().toString().padStart(2, "0")}`;
  return { start, end };
}

/**
 * Compute the previous calendar month relative to a reference date.
 *
 * @param now - Reference date for the calculation; uses current time when omitted. The computation uses UTC year/month fields.
 * @returns The previous month in `YYYY-MM` format (UTC).
 */
export function previousPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Determine the useful life in years for an asset.
 *
 * Prefers an explicit `asset.metadata.life_years` when it is a positive number or a numeric string.
 * If not present or invalid, falls back to `DEFAULT_LIFE_YEARS[asset.asset_type]`, and finally
 * to `FALLBACK_LIFE_YEARS` when no mapping exists for the asset type.
 *
 * @param asset - The asset whose useful life should be determined
 * @returns The number of years to use for depreciation calculations
 */
function lifeYearsFor(asset: Asset): number {
  const meta = (asset.metadata as Record<string, unknown> | null) ?? {};
  const meta_life = meta.life_years;
  if (typeof meta_life === "number" && meta_life > 0) return meta_life;
  if (typeof meta_life === "string" && /^\d+(\.\d+)?$/.test(meta_life)) {
    const n = Number(meta_life);
    if (n > 0) return n;
  }
  return DEFAULT_LIFE_YEARS[asset.asset_type] ?? FALLBACK_LIFE_YEARS;
}

/**
 * Compute the number of whole calendar months between two ISO dates.
 *
 * Both inputs must be in `YYYY-MM-DD` format; only the year and month components are used.
 *
 * @param fromIso - The start date string in `YYYY-MM-DD` format
 * @param toIso - The end date string in `YYYY-MM-DD` format
 * @returns The non-negative integer count of whole months from `fromIso` to `toIso` (based on year/month difference, clamped to `0`)
 */
function monthsBetween(fromIso: string, toIso: string): number {
  // Floor of (toIso - fromIso) in whole months. Both args are YYYY-MM-DD.
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/**
 * Compute the straight-line depreciation entry for an asset for a specific period.
 *
 * @param asset - The asset record to compute depreciation for
 * @param period - Target period in `YYYY-MM` format
 * @returns A `DepreciationEntry` for the asset and period, or `null` if the asset is not depreciable for that period (missing or invalid purchase data, retired/sold/written_off status, purchased after the period end, or already fully depreciated)
 */
export function entryFor(asset: Asset, period: string): DepreciationEntry | null {
  if (!asset.purchase_date || !asset.purchase_price) return null;
  // Skip retired/sold/written_off — they shouldn't continue depreciating.
  if (
    asset.status === "retired" ||
    asset.status === "sold" ||
    asset.status === "written_off"
  ) {
    return null;
  }
  const price = Number(asset.purchase_price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const lifeYears = lifeYearsFor(asset);
  const totalMonths = lifeYears * 12;
  const monthlyAmount = price / totalMonths;

  const { end: periodEnd } = periodBounds(period);
  // Don't depreciate before purchase.
  if (asset.purchase_date > periodEnd) return null;

  // Months in service is inclusive of the purchase month and the current
  // period; the schedule should emit `totalMonths` entries over the asset's
  // useful life, with the last one bringing the book value to zero. We skip
  // strictly past the schedule (monthsInService > totalMonths) — the final
  // scheduled month still gets an entry.
  const monthsInService = monthsBetween(asset.purchase_date, periodEnd) + 1;
  if (monthsInService <= 0) return null;
  if (monthsInService > totalMonths) return null;
  const cappedMonths = Math.min(monthsInService, totalMonths);
  const cumulative = monthlyAmount * cappedMonths;
  const remaining = Math.max(0, price - cumulative);

  return {
    asset_id: asset.id,
    property_id: asset.property_id,
    unit_id: asset.unit_id,
    asset_name: asset.name,
    asset_type: asset.asset_type,
    period,
    monthly_amount: round2(monthlyAmount),
    cumulative_amount: round2(cumulative),
    remaining_book_value: round2(remaining),
    life_years: lifeYears,
    purchase_date: asset.purchase_date,
    purchase_price: price,
  };
}

/**
 * Round a number to two decimal places.
 *
 * @param n - The input number to round
 * @returns The value rounded to two decimal places
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes depreciation entries for all depreciable assets within the given period.
 *
 * @param period - Target period in `YYYY-MM` format; assets purchased on or before the period end are considered.
 * @returns An array of `DepreciationEntry` objects for assets that are depreciable in the specified period.
 */
export async function computeMonthlyDepreciation(
  db: Db,
  period: string
): Promise<DepreciationEntry[]> {
  const { end: periodEnd } = periodBounds(period);
  const assets = (await db
    .select()
    .from(crAssets)
    .where(
      and(
        isNotNull(crAssets.purchase_date),
        isNotNull(crAssets.purchase_price),
        // Only assets purchased on or before the end of the period can
        // contribute. Drizzle's lte comparison on a date column is string-safe.
        lte(crAssets.purchase_date, periodEnd)
      )
    )) as Asset[];

  const out: DepreciationEntry[] = [];
  for (const asset of assets) {
    const e = entryFor(asset, period);
    if (e) out.push(e);
  }
  return out;
}

/**
 * Group depreciation entries by property and compute per-property totals for the given period.
 *
 * @param entries - Computed depreciation entries to group
 * @param period - Period identifier in `YYYY-MM` format used for each rollup
 * @returns An array of `PropertyRollup` objects (one per `property_id`) containing rounded totals (`total_monthly`, `total_cumulative`, `total_remaining_book_value`), the original `entries` for that property, and `by_asset_type` totals keyed by `asset_type`
 */
export function rollupByProperty(
  entries: DepreciationEntry[],
  period: string
): PropertyRollup[] {
  const byProp = new Map<string, DepreciationEntry[]>();
  for (const e of entries) {
    const arr = byProp.get(e.property_id) ?? [];
    arr.push(e);
    byProp.set(e.property_id, arr);
  }
  const rollups: PropertyRollup[] = [];
  for (const [property_id, propEntries] of byProp) {
    const byType: Record<string, number> = {};
    let total_monthly = 0;
    let total_cumulative = 0;
    let total_remaining = 0;
    for (const e of propEntries) {
      total_monthly += e.monthly_amount;
      total_cumulative += e.cumulative_amount;
      total_remaining += e.remaining_book_value;
      byType[e.asset_type] = round2((byType[e.asset_type] ?? 0) + e.monthly_amount);
    }
    rollups.push({
      property_id,
      period,
      total_monthly: round2(total_monthly),
      total_cumulative: round2(total_cumulative),
      total_remaining_book_value: round2(total_remaining),
      entries: propEntries,
      by_asset_type: byType,
    });
  }
  return rollups;
}

/**
 * Inserts a per-property depreciation report row for the rollup's period, avoiding duplicates.
 *
 * Uses the DB's partial unique index on (property_id, start_date, end_date) WHERE report_type='depreciation'
 * to ensure idempotent behavior across concurrent runs.
 *
 * @param db - Database client used to perform the insert
 * @param rollup - Property rollup containing period, property_id, totals, and entries to persist as the report
 * @returns `created` if a new report row was inserted, `skipped` if a conflicting row already exists
 */
export async function writeReport(
  db: Db,
  rollup: PropertyRollup
): Promise<"created" | "skipped"> {
  const { start, end } = periodBounds(rollup.period);
  const inserted = await db
    .insert(crFinancialReports)
    .values({
      title: `Depreciation — ${rollup.period}`,
      report_type: "depreciation",
      start_date: start,
      end_date: end,
      property_id: rollup.property_id,
      summary: `Straight-line depreciation across ${rollup.entries.length} asset(s); total $${rollup.total_monthly.toFixed(2)} for the month.`,
      metrics: {
        period: rollup.period,
        total_monthly: rollup.total_monthly,
        total_cumulative: rollup.total_cumulative,
        total_remaining_book_value: rollup.total_remaining_book_value,
        by_asset_type: rollup.by_asset_type,
        entries: rollup.entries,
      },
    })
    .onConflictDoNothing()
    .returning({ id: crFinancialReports.id });
  return inserted.length ? "created" : "skipped";
}

/**
 * Forward depreciation entries to ChittyFinance as expense transactions.
 *
 * If the finance client cannot be created from `env`, all entries are treated as skipped.
 * Processing continues on per-entry failures so a single failure does not abort the batch.
 *
 * @param env - Environment/config used to construct the finance client
 * @param entries - Depreciation entries to forward
 * @returns Counts of processed entries: `forwarded` is the number successfully posted, `skipped` is the number not posted
 */
export async function forwardToFinance(
  env: Parameters<typeof financeClient>[0],
  entries: DepreciationEntry[]
): Promise<{ forwarded: number; skipped: number }> {
  const client = financeClient(env);
  if (!client) return { forwarded: 0, skipped: entries.length };
  let forwarded = 0;
  let skipped = 0;
  for (const e of entries) {
    try {
      await client.post("/transactions", {
        type: "expense",
        category: "depreciation",
        amount: e.monthly_amount,
        currency: "USD",
        description: `Depreciation — ${e.asset_name} (${e.asset_type})`,
        date: periodBounds(e.period).end,
        external_id: `cr-dep-${e.asset_id}-${e.period}`,
        external_source: "chittyrental",
        metadata: {
          source: "chittyrental",
          asset_id: e.asset_id,
          property_id: e.property_id,
          period: e.period,
          remaining_book_value: e.remaining_book_value,
        },
      });
      forwarded++;
    } catch {
      // Don't abort the whole batch on one failure; the next pass will retry
      // anything missing because forwarding is keyed on `external_id`.
      skipped++;
    }
  }
  return { forwarded, skipped };
}

/**
 * Run the monthly depreciation pipeline for a given period, computing per-asset entries, aggregating per-property rollups, and optionally persisting reports and forwarding transactions.
 *
 * When `dryRun` is true the function performs only computations and returns the summary without writing reports, forwarding to the finance system, or creating an audit row.
 *
 * @param period - Period to process in `YYYY-MM` format
 * @param dryRun - If true, perform computation-only and do not persist reports or forward transactions
 * @returns An object summarizing the run containing:
 *  - `period`: the processed period string,
 *  - `dry_run`: whether the run was a dry run,
 *  - `properties`: number of property rollups produced,
 *  - `entries`: number of depreciation entries computed,
 *  - `total_amount`: total monthly depreciation amount rounded to 2 decimals,
 *  - `finance_forwarded`: count of entries successfully forwarded to the finance system,
 *  - `finance_skipped`: count of entries skipped/failed when forwarding,
 *  - `reports_written`: number of report rows created in the database
 */
export async function runDepreciation(
  env: Parameters<typeof financeClient>[0],
  db: Db,
  period: string,
  dryRun: boolean
): Promise<RunResult> {
  const entries = await computeMonthlyDepreciation(db, period);
  const rollups = rollupByProperty(entries, period);
  const totalAmount = entries.reduce((acc, e) => acc + e.monthly_amount, 0);

  let reportsWritten = 0;
  let forwarded = 0;
  let skipped = 0;
  if (!dryRun) {
    for (const r of rollups) {
      const outcome = await writeReport(db, r);
      if (outcome === "created") reportsWritten++;
    }
    const fwd = await forwardToFinance(env, entries);
    forwarded = fwd.forwarded;
    skipped = fwd.skipped;
  }

  // Dry-run is read-only — preview callers shouldn't create audit rows.
  if (!dryRun) {
    await db.insert(crSyncLog).values({
      source: "chittyrental",
      sync_type: "depreciation",
      direction: "outbound",
      status: "completed",
      records_synced: reportsWritten,
      error_message: null,
      completed_at: new Date(),
    });
  }

  return {
    period,
    dry_run: dryRun,
    properties: rollups.length,
    entries: entries.length,
    total_amount: round2(totalAmount),
    finance_forwarded: forwarded,
    finance_skipped: skipped,
    reports_written: reportsWritten,
  };
}
