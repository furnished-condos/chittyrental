-- Adds metadata JSONB to cr_properties, cr_units, cr_assets for GAM artifact storage
-- (shared_drive_id, resource_email, view_calendar_id, home_assistant_webhook, etc.)
-- and an external_id on cr_assets keyed by the inventory sheet.
ALTER TABLE "cr_properties" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "cr_units" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "cr_assets" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "cr_assets" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cr_assets_external_id_idx" ON "cr_assets" ("external_id") WHERE "external_id" IS NOT NULL;
