-- Adds metadata JSONB to cr_properties, cr_units, cr_assets for GAM artifact storage
-- (shared_drive_id, resource_email, view_calendar_id, home_assistant_webhook, etc.)
ALTER TABLE "cr_properties" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "cr_units" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
ALTER TABLE "cr_assets" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
