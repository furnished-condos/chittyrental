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

import { and, eq, isNotNull, lte } from "drizzle-orm";
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

/** Period helpers — period is `YYYY-MM`, lower-bounded inclusive on the 1st. */
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

export function previousPeriod(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${(d.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}`;
}

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

function monthsBetween(fromIso: string, toIso: string): number {
  // Floor of (toIso - fromIso) in whole months. Both args are YYYY-MM-DD.
  const [fy, fm] = fromIso.split("-").map(Number);
  const [ty, tm] = toIso.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

/**
 * Compute straight-line depreciation entries for one asset for the given
 * period. Returns null when the asset isn't depreciable (no purchase date /
 * price, or purchase is after the period, or already fully depreciated).
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

  const monthsElapsed = monthsBetween(asset.purchase_date, periodEnd);
  if (monthsElapsed <= 0) return null;
  const cappedMonths = Math.min(monthsElapsed, totalMonths);
  const cumulative = monthlyAmount * cappedMonths;
  const remaining = Math.max(0, price - cumulative);
  // Asset is fully depreciated — no further monthly entry to emit.
  if (cappedMonths >= totalMonths) {
    return null;
  }

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute entries across every depreciable asset for the period. */
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
 * Idempotent: if a (property_id, period) report already exists, returns
 * 'skipped'; otherwise inserts and returns 'created'.
 */
export async function writeReport(
  db: Db,
  rollup: PropertyRollup
): Promise<"created" | "skipped"> {
  const { start, end } = periodBounds(rollup.period);
  // Detect existing report by report_type + property_id + period bounds.
  const existing = await db
    .select({ id: crFinancialReports.id })
    .from(crFinancialReports)
    .where(
      and(
        eq(crFinancialReports.report_type, "depreciation"),
        eq(crFinancialReports.property_id, rollup.property_id),
        eq(crFinancialReports.start_date, start),
        eq(crFinancialReports.end_date, end)
      )
    )
    .limit(1);
  if (existing.length) return "skipped";

  await db.insert(crFinancialReports).values({
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
  });
  return "created";
}

/**
 * Forward each entry to ChittyFinance as an expense transaction. Returns
 * counts for { forwarded, skipped }. Skips silently when the client isn't
 * configured (CHITTYFINANCE_URL not set) — graceful degradation matching
 * the existing pattern.
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
 * End-to-end orchestration. dryRun=true computes + returns the summary
 * without persisting reports or forwarding to ChittyFinance.
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

  await db.insert(crSyncLog).values({
    source: "chittyrental",
    sync_type: "depreciation",
    direction: "outbound",
    status: dryRun ? "dry_run" : "completed",
    records_synced: dryRun ? 0 : reportsWritten,
    error_message: dryRun ? `dry_run: ${entries.length} entries computed` : null,
    completed_at: new Date(),
  });

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
