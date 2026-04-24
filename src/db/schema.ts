import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  boolean,
  date,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const timestamps = {
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ---------------------------------------------------------------------------
// cr_portfolios — property groupings linked to ChittyGov entities
// ---------------------------------------------------------------------------

export const crPortfolios = pgTable("cr_portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  gov_entity_id: text("gov_entity_id"), // ChittyGov entity_id e.g. "ENT-ITCANBE-001"
  status: text("status").notNull().default("active"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_properties — operational property data
// ---------------------------------------------------------------------------

export const crProperties = pgTable("cr_properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolio_id: uuid("portfolio_id").references(() => crPortfolios.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  property_type: text("property_type").notNull(), // single_family, multi_unit, condo, etc.
  status: text("status").notNull().default("setup"), // setup | available | occupied | maintenance | inactive
  jurisdiction: text("jurisdiction"),
  description: text("description"),
  airbnb_id: text("airbnb_id"),
  furnished_finder_id: text("furnished_finder_id"),
  zillow_id: text("zillow_id"),
  booking_id: text("booking_id"),
  apartments_id: text("apartments_id"),
  bedrooms: integer("bedrooms"),
  bathrooms: numeric("bathrooms"),
  sqft: integer("sqft"),
  amenities: jsonb("amenities"),
  images: jsonb("images"),
  rent_amount: numeric("rent_amount"), // default rent for the property
  rent_currency: text("rent_currency").notNull().default("USD"),
  security_deposit_amount: numeric("security_deposit_amount"),
  security_deposit_status: text("security_deposit_status"), // pending | held | released
  external_id: text("external_id"), // DoorLoop migration ID
  external_source: text("external_source"),
  gov_asset_id: text("gov_asset_id"),  // ChittyGov asset reference
  cf_property_id: text("cf_property_id"), // ChittyFinance reference
  metadata: jsonb("metadata"), // GAM artifacts (shared_drive_id, building_id, home_assistant_webhook, vrbo_id, etc.)
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_units — individual units within a property
// ---------------------------------------------------------------------------

export const crUnits = pgTable("cr_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => crProperties.id),
  unit_number: text("unit_number").notNull(),
  bedrooms: integer("bedrooms"),
  bathrooms: numeric("bathrooms"),
  sqft: integer("sqft"),
  floor: integer("floor"),
  status: text("status").notNull().default("available"),
  metadata: jsonb("metadata"), // GAM artifacts (resource_id, resource_email, view_calendar_id, etc.)
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_tenants — tenant lifecycle
// ---------------------------------------------------------------------------

export const crTenants = pgTable("cr_tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  first_name: text("first_name").notNull(),
  last_name: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  status: text("status").notNull().default("prospect"), // prospect | application | screening | approved | active | notice | past | rejected
  source: text("source"),
  background_check_status: text("background_check_status"), // pending | approved | rejected | not_started
  notes: text("notes"),
  documents: jsonb("documents"), // array of doc URLs
  external_id: text("external_id"), // DoorLoop migration ID
  external_source: text("external_source"), // doorloop | turbotenant | manual
  deleted_at: timestamp("deleted_at", { withTimezone: true }), // GDPR soft-delete
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_leases — lease lifecycle
// ---------------------------------------------------------------------------

export const crLeases = pgTable("cr_leases", {
  id: uuid("id").primaryKey().defaultRandom(),
  unit_id: uuid("unit_id").notNull().references(() => crUnits.id),
  tenant_id: uuid("tenant_id").notNull().references(() => crTenants.id),
  lease_type: text("lease_type").notNull(), // fixed | month_to_month | furnished_short_term
  start_date: date("start_date").notNull(),
  end_date: date("end_date"),
  monthly_rent: numeric("monthly_rent").notNull(),
  currency: text("currency").notNull().default("USD"),
  security_deposit: numeric("security_deposit"),
  security_deposit_status: text("security_deposit_status"),
  status: text("status").notNull().default("draft"), // draft | pending_signature | active | renewed | notice | expired | terminated
  agreement_id: uuid("agreement_id").references(() => crAgreements.id),
  signed_doc_url: text("signed_doc_url"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_agreements — fee models, VRF config, RLTO rules, waterfall sequences
// ---------------------------------------------------------------------------

export const crAgreements = pgTable("cr_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  agreement_type: text("agreement_type").notNull(), // pma | fee_model | jurisdiction_rules | vrf_config
  jurisdiction: text("jurisdiction"),
  rules: jsonb("rules"),
  version: integer("version").notNull().default(1),
  effective_from: date("effective_from"),
  effective_to: date("effective_to"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_vrf_ledger — per-property Virtual Reserve Fund tracking
// ---------------------------------------------------------------------------

export const crVrfLedger = pgTable("cr_vrf_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => crProperties.id),
  period: text("period").notNull(), // e.g. "2026-03"
  opening_balance: numeric("opening_balance").notNull().default("0"),
  contributions: numeric("contributions").notNull().default("0"),
  withdrawals: numeric("withdrawals").notNull().default("0"),
  closing_balance: numeric("closing_balance").notNull().default("0"),
  target_cap: numeric("target_cap"),
  status: text("status").notNull().default("funded"), // funded | underfunded | depleted
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_rent_ledger — rent payment tracking per lease
// ---------------------------------------------------------------------------

export const crRentLedger = pgTable("cr_rent_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  lease_id: uuid("lease_id").notNull().references(() => crLeases.id),
  period_start: date("period_start").notNull(),
  period_end: date("period_end").notNull(),
  amount_due: numeric("amount_due").notNull(),
  amount_paid: numeric("amount_paid").notNull().default("0"),
  due_date: date("due_date").notNull(),
  paid_date: date("paid_date"),
  status: text("status").notNull().default("due"), // due | partial | paid | late | waived | credited
  cf_transaction_id: text("cf_transaction_id"), // ChittyFinance backlink
  charge_id: text("charge_id"), // ChittyCharge backlink
  late_fee_applied: boolean("late_fee_applied").notNull().default(false),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_maintenance — work orders
// ---------------------------------------------------------------------------

export const crMaintenance = pgTable("cr_maintenance", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => crProperties.id),
  unit_id: uuid("unit_id").references(() => crUnits.id),
  reported_by: uuid("reported_by").references(() => crTenants.id),
  assigned_to: text("assigned_to"),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  status: text("status").notNull().default("open"), // open | in_progress | pending_parts | completed | cancelled
  cost_estimate: numeric("cost_estimate"),
  cost_actual: numeric("cost_actual"),
  photos: jsonb("photos"),
  entry_notice: jsonb("entry_notice"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_assets — property/unit assets (appliances, furniture, etc.)
// ---------------------------------------------------------------------------

export const crAssets = pgTable("cr_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => crProperties.id),
  unit_id: uuid("unit_id").references(() => crUnits.id),
  name: text("name").notNull(),
  asset_type: text("asset_type").notNull(),
  purchase_date: date("purchase_date"),
  purchase_price: numeric("purchase_price"),
  vendor: text("vendor"),
  model: text("model"),
  serial_number: text("serial_number"),
  status: text("status").notNull().default("active"), // planned | ordered | received | active | repair | missing | end_of_life | retired | sold | written_off
  warranty_expiration: date("warranty_expiration"),
  metadata: jsonb("metadata"), // reorder_threshold, life_years, service_interval_days, receipt_url, etc.
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_inspections — move-in/move-out/periodic inspections
// ---------------------------------------------------------------------------

export const crInspections = pgTable("cr_inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  unit_id: uuid("unit_id").notNull().references(() => crUnits.id),
  lease_id: uuid("lease_id").references(() => crLeases.id),
  inspection_type: text("inspection_type").notNull(), // move_in | move_out | periodic
  inspector: text("inspector"),
  inspection_date: date("inspection_date").notNull(),
  condition_report: jsonb("condition_report"),
  photos: jsonb("photos"),
  tenant_signed: boolean("tenant_signed").notNull().default(false),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_listings — platform listing sync state
// ---------------------------------------------------------------------------

export const crListings = pgTable("cr_listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").notNull().references(() => crProperties.id),
  unit_id: uuid("unit_id").references(() => crUnits.id),
  platform: text("platform").notNull(), // airbnb | furnished_finder | zillow | etc.
  external_id: text("external_id"),
  listing_url: text("listing_url"),
  status: text("status").notNull().default("draft"), // draft | active | paused | removed
  price_nightly: numeric("price_nightly"),
  price_monthly: numeric("price_monthly"),
  min_stay_nights: integer("min_stay_nights"),
  last_synced_at: timestamp("last_synced_at", { withTimezone: true }),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_setup_sessions — AI wizard state for property onboarding
// ---------------------------------------------------------------------------

export const crSetupSessions = pgTable("cr_setup_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").references(() => crProperties.id),
  portfolio_id: uuid("portfolio_id").references(() => crPortfolios.id),
  session_type: text("session_type").notNull(), // property_onboard | unit_setup | lease_wizard
  state: jsonb("state"),
  completed_steps: jsonb("completed_steps"),
  current_step: text("current_step"),
  status: text("status").notNull().default("in_progress"), // in_progress | completed | abandoned
  ai_suggestions: jsonb("ai_suggestions"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_sync_log — cross-service sync tracking
// ---------------------------------------------------------------------------

export const crSyncLog = pgTable("cr_sync_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  sync_type: text("sync_type").notNull(),
  direction: text("direction").notNull(), // inbound | outbound | bidirectional
  status: text("status").notNull().default("pending"), // pending | running | completed | failed
  records_synced: integer("records_synced"),
  error_message: text("error_message"),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_transactions — unified income/expense tracking (migrated from v1)
// ---------------------------------------------------------------------------

export const crTransactions = pgTable("cr_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  property_id: uuid("property_id").references(() => crProperties.id),
  amount: numeric("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  type: text("type").notNull(), // income | expense
  category: text("category").notNull(), // rent | maintenance | utilities | insurance | taxes | mortgage | supplies | cleaning | marketing | other
  description: text("description").notNull(),
  date: date("date").notNull(),
  ai_categorized: boolean("ai_categorized").notNull().default(false),
  ai_confidence: numeric("ai_confidence"),
  receipt_url: text("receipt_url"),
  external_id: text("external_id"),
  external_source: text("external_source"), // doorloop | mercury | wave | manual | quickbooks | turbotenant | huntington | alianza
  metadata: jsonb("metadata"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_financial_reports — periodic reports with AI insights
// ---------------------------------------------------------------------------

export const crFinancialReports = pgTable("cr_financial_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  report_type: text("report_type").notNull(), // monthly | quarterly | annual | custom
  start_date: date("start_date").notNull(),
  end_date: date("end_date").notNull(),
  property_id: uuid("property_id").references(() => crProperties.id),
  summary: text("summary"),
  ai_insights: text("ai_insights"),
  metrics: jsonb("metrics"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_payments — payment processing (ChittyCharge integration)
// ---------------------------------------------------------------------------

export const crPayments = pgTable("cr_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  lease_id: uuid("lease_id").references(() => crLeases.id),
  tenant_id: uuid("tenant_id").references(() => crTenants.id),
  amount: numeric("amount").notNull(),
  currency: text("currency").notNull().default("USD"),
  processing_fee: numeric("processing_fee"),
  status: text("status").notNull().default("pending"), // pending | completed | failed | refunded
  description: text("description"),
  due_date: date("due_date"),
  paid_at: timestamp("paid_at", { withTimezone: true }),
  charge_id: text("charge_id"), // ChittyCharge external ID
  external_id: text("external_id"), // payment processor ID
  ...timestamps,
});

// ---------------------------------------------------------------------------
// cr_comms — communication log (calls, messages, emails)
// ---------------------------------------------------------------------------

export const crComms = pgTable("cr_comms", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenant_id: uuid("tenant_id").references(() => crTenants.id),
  property_id: uuid("property_id").references(() => crProperties.id),
  channel: text("channel").notNull(), // phone | sms | email | openphone
  direction: text("direction").notNull(), // inbound | outbound
  content: text("content"),
  external_id: text("external_id"), // OpenPhone call/message ID
  phone_number: text("phone_number"),
  duration: integer("duration"), // seconds, for calls
  status: text("status"), // completed | missed | voicemail | sent | delivered
  metadata: jsonb("metadata"),
  occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ...timestamps,
});
