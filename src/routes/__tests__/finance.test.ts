import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../index";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import of the mocked modules.
// ---------------------------------------------------------------------------

vi.mock("../../db", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("../../lib/depreciation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/depreciation")>();
  return {
    ...original,
    // Keep pure helpers (periodBounds, previousPeriod) from real implementation.
    runDepreciation: vi.fn(),
    previewDepreciation: vi.fn(),
  };
});

import { getDb } from "../../db";
import { previewDepreciation, runDepreciation } from "../../lib/depreciation";
import financeRouter from "../finance";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal AppEnv bindings for tests. */
const testEnv: AppEnv["Bindings"] = {
  ENVIRONMENT: "test",
  DATABASE_URL: "postgres://test",
  CHITTY_AUTH_SERVICE_TOKEN: "token",
  CHITTYFINANCE_URL: "",
  CHITTYGOV_URL: "",
  CHITTYCHARGE_URL: "",
  CHITTYCONNECT_URL: "",
  SERVICE_NAME: "chittyrental",
  RENTAL_CACHE: {} as KVNamespace,
};

/**
 * Wrap the finance router in a standalone Hono app (no auth middleware),
 * and mount it at "/" so the test URLs match the router's own paths.
 */
function makeApp() {
  const app = new Hono<AppEnv>();
  app.route("/", financeRouter);
  return app;
}

function makeRunResult(overrides = {}) {
  return {
    period: "2024-03",
    dry_run: true,
    properties: 1,
    entries: 3,
    total_amount: 30,
    finance_forwarded: 0,
    finance_skipped: 0,
    reports_written: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /depreciation/run
// ---------------------------------------------------------------------------

describe("POST /depreciation/run", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue({} as ReturnType<typeof getDb>);
    vi.mocked(runDepreciation).mockResolvedValue(makeRunResult());
  });

  it("returns 200 with result for a valid period", async () => {
    const app = makeApp();
    const res = await app.request(
      "/depreciation/run?period=2024-03",
      { method: "POST" },
      testEnv
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown }>();
    expect(body).toHaveProperty("data");
  });

  it("defaults to previous period when period param is omitted", async () => {
    const app = makeApp();
    const res = await app.request("/depreciation/run", { method: "POST" }, testEnv);
    expect(res.status).toBe(200);
    expect(runDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])$/),
      expect.any(Boolean)
    );
  });

  it("returns 400 for an invalid period format", async () => {
    const app = makeApp();
    const res = await app.request(
      "/depreciation/run?period=2024-13",
      { method: "POST" },
      testEnv
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/period must be YYYY-MM/);
  });

  it("returns 400 for period without leading zero on month", async () => {
    const app = makeApp();
    const res = await app.request(
      "/depreciation/run?period=2024-3",
      { method: "POST" },
      testEnv
    );
    expect(res.status).toBe(400);
  });

  it("defaults dry_run to true (doesn't pass 'false')", async () => {
    const app = makeApp();
    await app.request("/depreciation/run?period=2024-03", { method: "POST" }, testEnv);
    expect(runDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2024-03",
      true // dry_run defaults to true
    );
  });

  it("sets dry_run=false when query param is 'false'", async () => {
    const app = makeApp();
    await app.request(
      "/depreciation/run?period=2024-03&dry_run=false",
      { method: "POST" },
      testEnv
    );
    expect(runDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2024-03",
      false
    );
  });

  it("returns 500 when runDepreciation throws", async () => {
    vi.mocked(runDepreciation).mockRejectedValue(new Error("DB connection failed"));
    const app = makeApp();
    const res = await app.request(
      "/depreciation/run?period=2024-03",
      { method: "POST" },
      testEnv
    );
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("DB connection failed");
  });

  it("calls getDb with the DATABASE_URL from env", async () => {
    const app = makeApp();
    await app.request("/depreciation/run?period=2024-03", { method: "POST" }, testEnv);
    expect(getDb).toHaveBeenCalledWith(testEnv.DATABASE_URL);
  });

  it("returns the full RunResult data inside { data: ... }", async () => {
    const expected = makeRunResult({ dry_run: false, reports_written: 2, finance_forwarded: 3 });
    vi.mocked(runDepreciation).mockResolvedValue(expected);
    const app = makeApp();
    const res = await app.request(
      "/depreciation/run?period=2024-03",
      { method: "POST" },
      testEnv
    );
    const body = await res.json<{ data: typeof expected }>();
    expect(body.data).toEqual(expected);
  });

  it("treats dry_run='true' as truthy (not false)", async () => {
    const app = makeApp();
    await app.request(
      "/depreciation/run?period=2024-03&dry_run=true",
      { method: "POST" },
      testEnv
    );
    expect(runDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2024-03",
      true // "true" !== "false" => dryRun=true
    );
  });
});

// ---------------------------------------------------------------------------
// GET /depreciation/preview
// ---------------------------------------------------------------------------

describe("GET /depreciation/preview", () => {
  beforeEach(() => {
    // Clear mock state from the POST /run describe block above so the
    // "never calls runDepreciation" assertion isn't polluted.
    vi.mocked(runDepreciation).mockClear();
    vi.mocked(getDb).mockReturnValue({} as ReturnType<typeof getDb>);
    // /preview now calls previewDepreciation (pure compute, no writes)
    // rather than runDepreciation.
    vi.mocked(previewDepreciation).mockResolvedValue({
      ...makeRunResult(),
      dry_run: true,
    });
  });

  it("returns 200 with result for a valid period", async () => {
    const app = makeApp();
    const res = await app.request("/depreciation/preview?period=2024-03", {}, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown }>();
    expect(body).toHaveProperty("data");
  });

  it("defaults to previous period when period param is omitted", async () => {
    const app = makeApp();
    const res = await app.request("/depreciation/preview", {}, testEnv);
    expect(res.status).toBe(200);
    expect(previewDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])$/)
    );
  });

  it("returns 400 for an invalid period format", async () => {
    const app = makeApp();
    const res = await app.request("/depreciation/preview?period=2024-00", {}, testEnv);
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/period must be YYYY-MM/);
  });

  it("never calls runDepreciation (preview is pure compute)", async () => {
    const app = makeApp();
    await app.request("/depreciation/preview?period=2024-03", {}, testEnv);
    expect(previewDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2024-03"
    );
    expect(runDepreciation).not.toHaveBeenCalled();
  });

  it("returns 500 when previewDepreciation throws", async () => {
    vi.mocked(previewDepreciation).mockRejectedValue(new Error("timeout"));
    const app = makeApp();
    const res = await app.request("/depreciation/preview?period=2024-03", {}, testEnv);
    expect(res.status).toBe(500);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("timeout");
  });

  it("calls getDb with the DATABASE_URL from env", async () => {
    const app = makeApp();
    await app.request("/depreciation/preview?period=2024-03", {}, testEnv);
    expect(getDb).toHaveBeenCalledWith(testEnv.DATABASE_URL);
  });

  it("returns the RunResult inside { data: ... }", async () => {
    const expected = {
      ...makeRunResult({ entries: 5, properties: 2, total_amount: 150 }),
      dry_run: true,
    };
    vi.mocked(previewDepreciation).mockResolvedValue(expected);
    const app = makeApp();
    const res = await app.request("/depreciation/preview?period=2024-03", {}, testEnv);
    const body = await res.json<{ data: typeof expected }>();
    expect(body.data).toEqual(expected);
  });

  it("handles period at year boundary (2023-12)", async () => {
    const app = makeApp();
    const res = await app.request("/depreciation/preview?period=2023-12", {}, testEnv);
    expect(res.status).toBe(200);
    expect(previewDepreciation).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "2023-12"
    );
  });

  it("rejects period with invalid month 00", async () => {
    const app = makeApp();
    const res = await app.request("/depreciation/preview?period=2024-00", {}, testEnv);
    expect(res.status).toBe(400);
  });
});