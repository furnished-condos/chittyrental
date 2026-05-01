-- Atomic-upsert key for the depreciation pass.
-- Scoped to depreciation reports only (partial index) so it doesn't constrain
-- other report_types, which are free to have multiple rows per period.
CREATE UNIQUE INDEX IF NOT EXISTS "cr_financial_reports_depreciation_period_idx"
  ON "cr_financial_reports" ("property_id", "start_date", "end_date")
  WHERE "report_type" = 'depreciation';
