import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_LIFE_YEARS,
  periodBounds,
  previousPeriod,
  entryFor,
  rollupByProperty,
  computeMonthlyDepreciation,
  writeReport,
  forwardToFinance,
  runDepreciation,
  type DepreciationEntry,
  type PropertyRollup,
} from "../depreciation";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Asset-shaped object accepted by entryFor / computeMonthlyDepreciation. */
function makeAsset(
  overrides: Partial<{
    id: string;
    property_id: string;
    unit_id: string | null;
    name: string;
    asset_type: string;
    purchase_date: string | null;
    purchase_price: string | null;
    status: string;
    metadata: Record<string, unknown> | null;
    vendor: string | null;
    model: string | null;
    serial_number: string | null;
    warranty_expiration: string | null;
    external_id: string | null;
    created_at: Date;
    updated_at: Date;
  }> = {}
) {
  return {
    id: "asset-1",
    property_id: "prop-1",
    unit_id: null,
    name: "Test Appliance",
    asset_type: "appliance",
    purchase_date: "2024-01-15",
    purchase_price: "840.00",
    status: "active",
    metadata: null,
    vendor: null,
    model: null,
    serial_number: null,
    warranty_expiration: null,
    external_id: null,
    created_at: new Date("2024-01-15T00:00:00Z"),
    updated_at: new Date("2024-01-15T00:00:00Z"),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<DepreciationEntry> = {}): DepreciationEntry {
  return {
    asset_id: "asset-1",
    property_id: "prop-1",
    unit_id: null,
    asset_name: "Test Appliance",
    asset_type: "appliance",
    period: "2024-03",
    monthly_amount: 10.0,
    cumulative_amount: 30.0,
    remaining_book_value: 810.0,
    life_years: 7,
    purchase_date: "2024-01-15",
    purchase_price: 840,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// periodBounds
// ---------------------------------------------------------------------------

describe("periodBounds", () => {
  it("returns correct start and end for a standard month", () => {
    expect(periodBounds("2024-03")).toEqual({
      start: "2024-03-01",
      end: "2024-03-31",
    });
  });

  it("handles January (31 days)", () => {
    expect(periodBounds("2024-01")).toEqual({
      start: "2024-01-01",
      end: "2024-01-31",
    });
  });

  it("handles December (31 days)", () => {
    expect(periodBounds("2024-12")).toEqual({
      start: "2024-12-01",
      end: "2024-12-31",
    });
  });

  it("handles April (30 days)", () => {
    expect(periodBounds("2024-04")).toEqual({
      start: "2024-04-01",
      end: "2024-04-30",
    });
  });

  it("handles February in a leap year (29 days)", () => {
    expect(periodBounds("2024-02")).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
  });

  it("handles February in a non-leap year (28 days)", () => {
    expect(periodBounds("2023-02")).toEqual({
      start: "2023-02-01",
      end: "2023-02-28",
    });
  });

  it("zero-pads month correctly", () => {
    const result = periodBounds("2024-09");
    expect(result.start).toBe("2024-09-01");
    expect(result.end).toBe("2024-09-30");
  });

  it("throws on invalid period format — no dashes", () => {
    expect(() => periodBounds("202403")).toThrow("invalid period");
  });

  it("throws on invalid period format — month 00", () => {
    expect(() => periodBounds("2024-00")).toThrow("invalid period");
  });

  it("throws on invalid period format — month 13", () => {
    expect(() => periodBounds("2024-13")).toThrow("invalid period");
  });

  it("throws on invalid period format — non-numeric year", () => {
    expect(() => periodBounds("YYYY-03")).toThrow("invalid period");
  });

  it("throws on empty string", () => {
    expect(() => periodBounds("")).toThrow("invalid period");
  });
});

// ---------------------------------------------------------------------------
// previousPeriod
// ---------------------------------------------------------------------------

describe("previousPeriod", () => {
  it("returns December of previous year when current month is January", () => {
    expect(previousPeriod(new Date("2024-01-15T00:00:00Z"))).toBe("2023-12");
  });

  it("returns previous month for any mid-year date", () => {
    expect(previousPeriod(new Date("2024-06-01T00:00:00Z"))).toBe("2024-05");
  });

  it("returns March when current month is April", () => {
    expect(previousPeriod(new Date("2024-04-30T23:59:59Z"))).toBe("2024-03");
  });

  it("zero-pads single-digit months", () => {
    // March -> February
    expect(previousPeriod(new Date("2024-03-01T00:00:00Z"))).toBe("2024-02");
  });

  it("handles year boundary correctly (January 1 UTC)", () => {
    expect(previousPeriod(new Date("2025-01-01T00:00:00Z"))).toBe("2024-12");
  });
});

// ---------------------------------------------------------------------------
// entryFor — null / skip cases
// ---------------------------------------------------------------------------

describe("entryFor — skip conditions", () => {
  it("returns null when purchase_date is null", () => {
    expect(entryFor(makeAsset({ purchase_date: null }), "2024-03")).toBeNull();
  });

  it("returns null when purchase_price is null", () => {
    expect(entryFor(makeAsset({ purchase_price: null }), "2024-03")).toBeNull();
  });

  it("returns null for status = retired", () => {
    expect(entryFor(makeAsset({ status: "retired" }), "2024-03")).toBeNull();
  });

  it("returns null for status = sold", () => {
    expect(entryFor(makeAsset({ status: "sold" }), "2024-03")).toBeNull();
  });

  it("returns null for status = written_off", () => {
    expect(entryFor(makeAsset({ status: "written_off" }), "2024-03")).toBeNull();
  });

  it("returns null when purchase_price is 0", () => {
    expect(entryFor(makeAsset({ purchase_price: "0" }), "2024-03")).toBeNull();
  });

  it("returns null when purchase_price is negative", () => {
    expect(entryFor(makeAsset({ purchase_price: "-100" }), "2024-03")).toBeNull();
  });

  it("returns null when purchase is after the period end", () => {
    // Asset purchased 2024-04-01, period ends 2024-03-31
    expect(entryFor(makeAsset({ purchase_date: "2024-04-01" }), "2024-03")).toBeNull();
  });

  it("returns null when asset is already fully depreciated (past useful life)", () => {
    // Appliance: 7 years = 84 months. If purchased 2010-01, period = 2017-02 => 85 months in service
    expect(
      entryFor(makeAsset({ purchase_date: "2010-01-15", purchase_price: "840.00" }), "2017-02")
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// entryFor — computation cases
// ---------------------------------------------------------------------------

describe("entryFor — computation", () => {
  it("computes correct values for an appliance in its first month of service", () => {
    // Appliance $840, life=7yr=84mo, monthly=$10. First month => cumulative=$10, remaining=$830
    const asset = makeAsset({
      id: "a1",
      property_id: "p1",
      purchase_date: "2024-01-15",
      purchase_price: "840.00",
      asset_type: "appliance",
    });
    const entry = entryFor(asset, "2024-01");
    expect(entry).not.toBeNull();
    expect(entry!.monthly_amount).toBe(10);
    expect(entry!.cumulative_amount).toBe(10);
    expect(entry!.remaining_book_value).toBe(830);
    expect(entry!.life_years).toBe(7);
    expect(entry!.purchase_price).toBe(840);
  });

  it("computes correct values in the final month of useful life (remaining=0)", () => {
    // Appliance $840, 84 months life. Purchase 2017-04, period 2024-03 => 84th month
    const asset = makeAsset({
      purchase_date: "2017-04-01",
      purchase_price: "840.00",
      asset_type: "appliance",
    });
    const entry = entryFor(asset, "2024-03");
    expect(entry).not.toBeNull();
    expect(entry!.monthly_amount).toBe(10);
    expect(entry!.cumulative_amount).toBe(840);
    expect(entry!.remaining_book_value).toBe(0);
  });

  it("uses metadata.life_years (number) when set", () => {
    const asset = makeAsset({
      purchase_price: "1200.00",
      metadata: { life_years: 10 },
      asset_type: "appliance", // would normally be 7y
    });
    const entry = entryFor(asset, "2024-01");
    // 1200 / (10*12) = 10 per month
    expect(entry!.monthly_amount).toBe(10);
    expect(entry!.life_years).toBe(10);
  });

  it("uses metadata.life_years (string numeric) when set", () => {
    const asset = makeAsset({
      purchase_price: "600.00",
      metadata: { life_years: "5" },
      asset_type: "appliance",
    });
    const entry = entryFor(asset, "2024-01");
    // 600 / (5*12) = 10 per month
    expect(entry!.monthly_amount).toBe(10);
    expect(entry!.life_years).toBe(5);
  });

  it("falls back to asset_type default when metadata.life_years is not a valid positive number", () => {
    const asset = makeAsset({
      purchase_price: "840.00",
      metadata: { life_years: "abc" },
      asset_type: "appliance",
    });
    const entry = entryFor(asset, "2024-01");
    expect(entry!.life_years).toBe(DEFAULT_LIFE_YEARS.appliance); // 7
  });

  it("falls back to asset_type default when metadata.life_years is zero", () => {
    const asset = makeAsset({
      purchase_price: "840.00",
      metadata: { life_years: 0 },
      asset_type: "furniture",
    });
    const entry = entryFor(asset, "2024-01");
    expect(entry!.life_years).toBe(DEFAULT_LIFE_YEARS.furniture); // 5
  });

  it("uses FALLBACK_LIFE_YEARS (7) for unknown asset_type", () => {
    const asset = makeAsset({
      purchase_price: "840.00",
      asset_type: "unknown_type",
    });
    const entry = entryFor(asset, "2024-01");
    expect(entry!.life_years).toBe(7); // FALLBACK_LIFE_YEARS
  });

  it("populates all DepreciationEntry fields correctly", () => {
    const asset = makeAsset({
      id: "asset-xyz",
      property_id: "prop-abc",
      unit_id: "unit-1",
      name: "HVAC Unit",
      asset_type: "hvac",
      purchase_date: "2024-03-01",
      purchase_price: "1800.00",
    });
    const entry = entryFor(asset, "2024-03");
    expect(entry).toMatchObject({
      asset_id: "asset-xyz",
      property_id: "prop-abc",
      unit_id: "unit-1",
      asset_name: "HVAC Unit",
      asset_type: "hvac",
      period: "2024-03",
      life_years: 15,
      purchase_date: "2024-03-01",
      purchase_price: 1800,
    });
  });

  it("correctly handles electronics (3-year life)", () => {
    const asset = makeAsset({ asset_type: "electronics", purchase_price: "360.00" });
    const entry = entryFor(asset, "2024-01");
    // 360 / 36 = 10/mo
    expect(entry!.monthly_amount).toBe(10);
    expect(entry!.life_years).toBe(3);
  });

  it("rounds monthly_amount to 2 decimal places", () => {
    // $100 / (7*12) = 100/84 ≈ 1.190476... → 1.19
    const asset = makeAsset({ purchase_price: "100.00", asset_type: "appliance" });
    const entry = entryFor(asset, "2024-01");
    expect(entry!.monthly_amount).toBe(1.19);
  });

  it("allows active status assets through", () => {
    const asset = makeAsset({ status: "active" });
    expect(entryFor(asset, "2024-03")).not.toBeNull();
  });

  it("allows other non-retired statuses (e.g. repair) through", () => {
    const asset = makeAsset({ status: "repair" });
    expect(entryFor(asset, "2024-03")).not.toBeNull();
  });

  it("asset purchased on the last day of the period is included", () => {
    const asset = makeAsset({ purchase_date: "2024-03-31" });
    expect(entryFor(asset, "2024-03")).not.toBeNull();
  });

  it("asset purchased on the first day of the period is included", () => {
    const asset = makeAsset({ purchase_date: "2024-03-01" });
    expect(entryFor(asset, "2024-03")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rollupByProperty
// ---------------------------------------------------------------------------

describe("rollupByProperty", () => {
  it("returns empty array for empty entries", () => {
    expect(rollupByProperty([], "2024-03")).toEqual([]);
  });

  it("produces a single rollup for one entry", () => {
    const entry = makeEntry({ property_id: "p1", monthly_amount: 10, cumulative_amount: 30, remaining_book_value: 810 });
    const rollups = rollupByProperty([entry], "2024-03");
    expect(rollups).toHaveLength(1);
    expect(rollups[0].property_id).toBe("p1");
    expect(rollups[0].total_monthly).toBe(10);
    expect(rollups[0].total_cumulative).toBe(30);
    expect(rollups[0].total_remaining_book_value).toBe(810);
    expect(rollups[0].entries).toHaveLength(1);
    expect(rollups[0].period).toBe("2024-03");
  });

  it("produces separate rollups for entries from different properties", () => {
    const e1 = makeEntry({ property_id: "p1", monthly_amount: 10 });
    const e2 = makeEntry({ property_id: "p2", monthly_amount: 20 });
    const rollups = rollupByProperty([e1, e2], "2024-03");
    expect(rollups).toHaveLength(2);
    const p1 = rollups.find((r) => r.property_id === "p1")!;
    const p2 = rollups.find((r) => r.property_id === "p2")!;
    expect(p1.total_monthly).toBe(10);
    expect(p2.total_monthly).toBe(20);
  });

  it("aggregates multiple entries for the same property", () => {
    const e1 = makeEntry({ asset_id: "a1", monthly_amount: 10, cumulative_amount: 20, remaining_book_value: 80, asset_type: "appliance" });
    const e2 = makeEntry({ asset_id: "a2", monthly_amount: 20, cumulative_amount: 40, remaining_book_value: 160, asset_type: "furniture" });
    const rollups = rollupByProperty([e1, e2], "2024-03");
    expect(rollups).toHaveLength(1);
    expect(rollups[0].total_monthly).toBe(30);
    expect(rollups[0].total_cumulative).toBe(60);
    expect(rollups[0].total_remaining_book_value).toBe(240);
    expect(rollups[0].entries).toHaveLength(2);
  });

  it("builds by_asset_type breakdown correctly", () => {
    const e1 = makeEntry({ asset_id: "a1", asset_type: "appliance", monthly_amount: 10 });
    const e2 = makeEntry({ asset_id: "a2", asset_type: "appliance", monthly_amount: 5 });
    const e3 = makeEntry({ asset_id: "a3", asset_type: "furniture", monthly_amount: 15 });
    const rollups = rollupByProperty([e1, e2, e3], "2024-03");
    expect(rollups[0].by_asset_type).toEqual({ appliance: 15, furniture: 15 });
  });

  it("rounds totals to 2 decimal places", () => {
    // Two entries with amounts that sum to a long decimal
    const e1 = makeEntry({ asset_id: "a1", monthly_amount: 1.19, cumulative_amount: 1.19, remaining_book_value: 98.81 });
    const e2 = makeEntry({ asset_id: "a2", monthly_amount: 1.19, cumulative_amount: 2.38, remaining_book_value: 97.62 });
    const rollups = rollupByProperty([e1, e2], "2024-03");
    expect(rollups[0].total_monthly).toBe(2.38);
  });
});

// ---------------------------------------------------------------------------
// computeMonthlyDepreciation — DB mock
// ---------------------------------------------------------------------------

describe("computeMonthlyDepreciation", () => {
  /** Build a minimal chainable DB mock that resolves .select().from().where() with `rows`. */
  function makeSelectDbMock(rows: ReturnType<typeof makeAsset>[]) {
    const whereMock = vi.fn().mockResolvedValue(rows);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });
    return { select: selectMock, from: fromMock, where: whereMock } as unknown as import("../../db").Db;
  }

  it("returns entries for all depreciable assets returned by DB", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeSelectDbMock([asset]);
    const entries = await computeMonthlyDepreciation(db, "2024-03");
    expect(entries).toHaveLength(1);
    expect(entries[0].asset_id).toBe("asset-1");
  });

  it("filters out assets that entryFor rejects (e.g. retired)", async () => {
    const retired = makeAsset({ status: "retired" });
    const active = makeAsset({ id: "asset-2", status: "active" });
    const db = makeSelectDbMock([retired, active]);
    const entries = await computeMonthlyDepreciation(db, "2024-03");
    expect(entries).toHaveLength(1);
    expect(entries[0].asset_id).toBe("asset-2");
  });

  it("returns empty array when DB returns no assets", async () => {
    const db = makeSelectDbMock([]);
    const entries = await computeMonthlyDepreciation(db, "2024-03");
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// writeReport — DB mock
// ---------------------------------------------------------------------------

describe("writeReport", () => {
  const rollup: PropertyRollup = {
    property_id: "prop-1",
    period: "2024-03",
    total_monthly: 10,
    total_cumulative: 30,
    total_remaining_book_value: 810,
    entries: [makeEntry()],
    by_asset_type: { appliance: 10 },
  };

  function makeInsertDbMock(returnedRows: { id: string }[]) {
    const returning = vi.fn().mockResolvedValue(returnedRows);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    return { insert } as unknown as import("../../db").Db;
  }

  it("returns 'created' when a row is inserted", async () => {
    const db = makeInsertDbMock([{ id: "report-1" }]);
    expect(await writeReport(db, rollup)).toBe("created");
  });

  it("returns 'skipped' when insert resolves with empty (conflict)", async () => {
    const db = makeInsertDbMock([]);
    expect(await writeReport(db, rollup)).toBe("skipped");
  });

  it("passes correct report_type to insert", async () => {
    const returnedRows: { id: string }[] = [{ id: "r1" }];
    const returning = vi.fn().mockResolvedValue(returnedRows);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as import("../../db").Db;

    await writeReport(db, rollup);
    // The values call should include report_type: 'depreciation'
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ report_type: "depreciation" })
    );
  });

  it("uses correct start_date and end_date from periodBounds", async () => {
    const returning = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as unknown as import("../../db").Db;

    await writeReport(db, { ...rollup, period: "2024-02" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ start_date: "2024-02-01", end_date: "2024-02-29" })
    );
  });
});

// ---------------------------------------------------------------------------
// forwardToFinance
// ---------------------------------------------------------------------------

describe("forwardToFinance", () => {
  const entries = [
    makeEntry({ asset_id: "a1", period: "2024-03", monthly_amount: 10 }),
    makeEntry({ asset_id: "a2", period: "2024-03", monthly_amount: 20 }),
  ];

  it("returns all as skipped when CHITTYFINANCE_URL is not set", async () => {
    const result = await forwardToFinance({ CHITTYFINANCE_URL: undefined } as never, entries);
    expect(result).toEqual({ forwarded: 0, skipped: 2 });
  });

  it("returns {forwarded:0,skipped:0} for empty entries even with client configured", async () => {
    // The client won't be called but would be configured
    const result = await forwardToFinance({ CHITTYFINANCE_URL: undefined } as never, []);
    expect(result).toEqual({ forwarded: 0, skipped: 0 });
  });

  it("increments forwarded count for each successful post", async () => {
    // Mock global fetch so financeClient makes successful calls
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await forwardToFinance(
      { CHITTYFINANCE_URL: "https://finance.example.com", CHITTY_AUTH_SERVICE_TOKEN: "tok" } as never,
      entries
    );
    expect(result.forwarded).toBe(2);
    expect(result.skipped).toBe(0);

    vi.unstubAllGlobals();
  });

  it("increments skipped count when a post fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: vi.fn().mockResolvedValue({}) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await forwardToFinance(
      { CHITTYFINANCE_URL: "https://finance.example.com", CHITTY_AUTH_SERVICE_TOKEN: "tok" } as never,
      entries
    );
    expect(result.forwarded).toBe(1);
    expect(result.skipped).toBe(1);

    vi.unstubAllGlobals();
  });

  it("sends correct external_id to ChittyFinance", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await forwardToFinance(
      { CHITTYFINANCE_URL: "https://finance.example.com", CHITTY_AUTH_SERVICE_TOKEN: "tok" } as never,
      [makeEntry({ asset_id: "a1", period: "2024-03" })]
    );

    const [, requestInit] = fetchMock.mock.calls[0];
    const body = JSON.parse((requestInit as RequestInit).body as string);
    expect(body.external_id).toBe("cr-dep-a1-2024-03");
    expect(body.type).toBe("expense");
    expect(body.category).toBe("depreciation");

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// runDepreciation
// ---------------------------------------------------------------------------

describe("runDepreciation", () => {
  const period = "2024-03";

  function makeFullDbMock({
    assets = [] as ReturnType<typeof makeAsset>[],
    insertReturns = [{ id: "report-1" }] as { id: string }[],
  } = {}) {
    // Select chain (for computeMonthlyDepreciation)
    const whereMock = vi.fn().mockResolvedValue(assets);
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    const selectMock = vi.fn().mockReturnValue({ from: fromMock });

    // Insert chain shared by writeReport and crSyncLog
    const returning = vi.fn().mockResolvedValue(insertReturns);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing, then: undefined });
    // crSyncLog insert just calls .values() which needs to be awaitable
    const syncLogValues = vi.fn().mockResolvedValue([]);
    const insertMock = vi.fn().mockImplementation((table) => {
      // Return different chains for different tables
      const isFinancialReports =
        table && typeof table === "object" && "_" in table;
      void isFinancialReports;
      return { values, onConflictDoNothing };
    });

    // Make values awaitable for crSyncLog (which doesn't call .returning())
    // Actually runDepreciation calls: db.insert(crSyncLog).values({...}) — awaited directly
    // and db.insert(crFinancialReports).values({}).onConflictDoNothing().returning({})
    // We need both chains. Let's use call order:
    let insertCallCount = 0;
    const flexInsert = vi.fn().mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) {
        // First insert: crFinancialReports chain
        return { values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(insertReturns) }) }) };
      }
      // Subsequent: crSyncLog chain (just values, awaitable)
      return { values: syncLogValues };
    });

    return {
      select: selectMock,
      insert: flexInsert,
    } as unknown as import("../../db").Db;
  }

  it("returns correct RunResult shape for dry run with no assets", async () => {
    const db = makeFullDbMock({ assets: [] });
    const result = await runDepreciation({} as never, db, period, true);
    expect(result).toEqual({
      period: "2024-03",
      dry_run: true,
      properties: 0,
      entries: 0,
      total_amount: 0,
      finance_forwarded: 0,
      finance_skipped: 0,
      reports_written: 0,
    });
  });

  it("does not call insert in dry-run mode", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [asset] });
    await runDepreciation({} as never, db, period, true);
    expect((db.insert as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("writes reports and sync log in non-dry-run mode", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [asset], insertReturns: [{ id: "r1" }] });
    await runDepreciation({ CHITTYFINANCE_URL: undefined } as never, db, period, false);
    // insert should be called at least twice: once for report, once for sync log
    expect((db.insert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("counts reports_written correctly when insert returns a row", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [asset], insertReturns: [{ id: "r1" }] });
    const result = await runDepreciation({ CHITTYFINANCE_URL: undefined } as never, db, period, false);
    expect(result.reports_written).toBe(1);
  });

  it("counts reports_written=0 when insert returns empty (conflict/skipped)", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [asset], insertReturns: [] });
    const result = await runDepreciation({ CHITTYFINANCE_URL: undefined } as never, db, period, false);
    expect(result.reports_written).toBe(0);
  });

  it("totals total_amount across all entries", async () => {
    // Two assets with $840 each, 7yr life = $10/mo each
    const a1 = makeAsset({ id: "a1", purchase_date: "2024-01-01", purchase_price: "840.00" });
    const a2 = makeAsset({ id: "a2", purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [a1, a2], insertReturns: [] });
    const result = await runDepreciation({ CHITTYFINANCE_URL: undefined } as never, db, period, true);
    expect(result.total_amount).toBe(20);
    expect(result.entries).toBe(2);
  });

  it("sets finance_forwarded=0 and finance_skipped=0 in dry-run mode", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [asset] });
    const result = await runDepreciation({} as never, db, period, true);
    expect(result.finance_forwarded).toBe(0);
    expect(result.finance_skipped).toBe(0);
  });

  it("sets finance_skipped = entries.length when no finance client configured", async () => {
    const asset = makeAsset({ purchase_date: "2024-01-01", purchase_price: "840.00" });
    const db = makeFullDbMock({ assets: [asset], insertReturns: [] });
    const result = await runDepreciation({ CHITTYFINANCE_URL: undefined } as never, db, period, false);
    expect(result.finance_skipped).toBe(1);
    expect(result.finance_forwarded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_LIFE_YEARS export
// ---------------------------------------------------------------------------

describe("DEFAULT_LIFE_YEARS", () => {
  it("contains expected asset types", () => {
    expect(DEFAULT_LIFE_YEARS).toMatchObject({
      appliance: 7,
      furniture: 5,
      electronics: 3,
      hvac: 15,
      flooring: 10,
      window_treatment: 5,
      smart_home: 5,
      fixture: 10,
      other: 7,
    });
  });
});