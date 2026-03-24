CREATE TABLE IF NOT EXISTS "cr_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"agreement_type" text NOT NULL,
	"jurisdiction" text,
	"rules" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"name" text NOT NULL,
	"asset_type" text NOT NULL,
	"purchase_date" date,
	"purchase_price" numeric,
	"vendor" text,
	"model" text,
	"serial_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"warranty_expiration" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_comms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"property_id" uuid,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"content" text,
	"external_id" text,
	"phone_number" text,
	"duration" integer,
	"status" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_financial_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"report_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"property_id" uuid,
	"summary" text,
	"ai_insights" text,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"lease_id" uuid,
	"inspection_type" text NOT NULL,
	"inspector" text,
	"inspection_date" date NOT NULL,
	"condition_report" jsonb,
	"photos" jsonb,
	"tenant_signed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_type" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"monthly_rent" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"security_deposit" numeric,
	"security_deposit_status" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"agreement_id" uuid,
	"signed_doc_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"platform" text NOT NULL,
	"external_id" text,
	"listing_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"price_nightly" numeric,
	"price_monthly" numeric,
	"min_stay_nights" integer,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid,
	"reported_by" uuid,
	"assigned_to" text,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"cost_estimate" numeric,
	"cost_actual" numeric,
	"photos" jsonb,
	"entry_notice" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid,
	"tenant_id" uuid,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"processing_fee" numeric,
	"status" text DEFAULT 'pending' NOT NULL,
	"description" text,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"charge_id" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"gov_entity_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"property_type" text NOT NULL,
	"status" text DEFAULT 'setup' NOT NULL,
	"jurisdiction" text,
	"description" text,
	"airbnb_id" text,
	"furnished_finder_id" text,
	"zillow_id" text,
	"booking_id" text,
	"apartments_id" text,
	"bedrooms" integer,
	"bathrooms" numeric,
	"sqft" integer,
	"amenities" jsonb,
	"images" jsonb,
	"rent_amount" numeric,
	"rent_currency" text DEFAULT 'USD' NOT NULL,
	"security_deposit_amount" numeric,
	"security_deposit_status" text,
	"external_id" text,
	"external_source" text,
	"gov_asset_id" text,
	"cf_property_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_rent_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_due" numeric NOT NULL,
	"amount_paid" numeric DEFAULT '0' NOT NULL,
	"due_date" date NOT NULL,
	"paid_date" date,
	"status" text DEFAULT 'due' NOT NULL,
	"cf_transaction_id" text,
	"charge_id" text,
	"late_fee_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_setup_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"portfolio_id" uuid,
	"session_type" text NOT NULL,
	"state" jsonb,
	"completed_steps" jsonb,
	"current_step" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"ai_suggestions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"sync_type" text NOT NULL,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"records_synced" integer,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"status" text DEFAULT 'prospect' NOT NULL,
	"source" text,
	"background_check_status" text,
	"notes" text,
	"documents" jsonb,
	"external_id" text,
	"external_source" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"date" date NOT NULL,
	"ai_categorized" boolean DEFAULT false NOT NULL,
	"ai_confidence" numeric,
	"receipt_url" text,
	"external_id" text,
	"external_source" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_number" text NOT NULL,
	"bedrooms" integer,
	"bathrooms" numeric,
	"sqft" integer,
	"floor" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cr_vrf_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"period" text NOT NULL,
	"opening_balance" numeric DEFAULT '0' NOT NULL,
	"contributions" numeric DEFAULT '0' NOT NULL,
	"withdrawals" numeric DEFAULT '0' NOT NULL,
	"closing_balance" numeric DEFAULT '0' NOT NULL,
	"target_cap" numeric,
	"status" text DEFAULT 'funded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_assets" ADD CONSTRAINT "cr_assets_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_assets" ADD CONSTRAINT "cr_assets_unit_id_cr_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."cr_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_comms" ADD CONSTRAINT "cr_comms_tenant_id_cr_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."cr_tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_comms" ADD CONSTRAINT "cr_comms_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_financial_reports" ADD CONSTRAINT "cr_financial_reports_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_inspections" ADD CONSTRAINT "cr_inspections_unit_id_cr_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."cr_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_inspections" ADD CONSTRAINT "cr_inspections_lease_id_cr_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."cr_leases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_leases" ADD CONSTRAINT "cr_leases_unit_id_cr_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."cr_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_leases" ADD CONSTRAINT "cr_leases_tenant_id_cr_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."cr_tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_leases" ADD CONSTRAINT "cr_leases_agreement_id_cr_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."cr_agreements"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_listings" ADD CONSTRAINT "cr_listings_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_listings" ADD CONSTRAINT "cr_listings_unit_id_cr_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."cr_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_maintenance" ADD CONSTRAINT "cr_maintenance_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_maintenance" ADD CONSTRAINT "cr_maintenance_unit_id_cr_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."cr_units"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_maintenance" ADD CONSTRAINT "cr_maintenance_reported_by_cr_tenants_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."cr_tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_payments" ADD CONSTRAINT "cr_payments_lease_id_cr_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."cr_leases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_payments" ADD CONSTRAINT "cr_payments_tenant_id_cr_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."cr_tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_properties" ADD CONSTRAINT "cr_properties_portfolio_id_cr_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."cr_portfolios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_rent_ledger" ADD CONSTRAINT "cr_rent_ledger_lease_id_cr_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."cr_leases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_setup_sessions" ADD CONSTRAINT "cr_setup_sessions_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_setup_sessions" ADD CONSTRAINT "cr_setup_sessions_portfolio_id_cr_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."cr_portfolios"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_transactions" ADD CONSTRAINT "cr_transactions_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_units" ADD CONSTRAINT "cr_units_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cr_vrf_ledger" ADD CONSTRAINT "cr_vrf_ledger_property_id_cr_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."cr_properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
