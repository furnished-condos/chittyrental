-- Market Intelligence Layer for ChittyRental
-- Read-only signal ingestion for pricing & positioning intelligence
-- No raw listings stored - derived signals only

-- Market Area Signals: aggregated market data per micro-area
CREATE TABLE "cr_market_area_signals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Geographic scope
    "micro_area" text NOT NULL,
    "city" text NOT NULL,
    "country" text DEFAULT 'DE' NOT NULL,
    "postal_code" text,

    -- Core rent signals (EUR/sqm)
    "median_rent_furnished" numeric(8, 2),
    "median_rent_unfurnished" numeric(8, 2),
    "furnished_premium_percent" numeric(5, 2),

    -- Rent bands (EUR/sqm)
    "rent_p25_furnished" numeric(8, 2),
    "rent_p75_furnished" numeric(8, 2),
    "rent_p25_unfurnished" numeric(8, 2),
    "rent_p75_unfurnished" numeric(8, 2),

    -- Time-on-market signals (days)
    "median_days_on_market" integer,
    "avg_days_on_market" integer,

    -- Supply velocity signals
    "new_listings_weekly" integer,
    "price_reduction_frequency" numeric(5, 2),
    "avg_price_reduction_percent" numeric(5, 2),

    -- Demand indicators
    "inquiry_velocity_index" numeric(5, 2),
    "absorption_rate" numeric(5, 2),

    -- Sample metadata
    "sample_size" integer,
    "data_source" text NOT NULL,
    "signal_date" timestamp with time zone NOT NULL,

    -- Governance
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "cr_market_area_signals_micro_area_idx" ON "cr_market_area_signals" ("micro_area");
CREATE INDEX "cr_market_area_signals_city_idx" ON "cr_market_area_signals" ("city");
CREATE INDEX "cr_market_area_signals_signal_date_idx" ON "cr_market_area_signals" ("signal_date");

-- Pricing Alerts: flags for over/underpricing vs market bands
CREATE TABLE "cr_pricing_alerts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "property_id" uuid NOT NULL,
    "market_area_signal_id" uuid,

    -- Alert details
    "alert_type" text NOT NULL,
    "current_rent_per_sqm" numeric(8, 2) NOT NULL,
    "market_median_per_sqm" numeric(8, 2) NOT NULL,
    "deviation_percent" numeric(5, 2) NOT NULL,

    -- Justification (for premium_justified cases)
    "justification_notes" text,

    -- Status
    "is_acknowledged" boolean DEFAULT false NOT NULL,
    "acknowledged_by" uuid,
    "acknowledged_at" timestamp with time zone,

    "created_at" timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT "cr_pricing_alerts_property_id_fk"
        FOREIGN KEY ("property_id") REFERENCES "cr_properties"("id") ON DELETE CASCADE,
    CONSTRAINT "cr_pricing_alerts_market_area_signal_id_fk"
        FOREIGN KEY ("market_area_signal_id") REFERENCES "cr_market_area_signals"("id") ON DELETE SET NULL,
    CONSTRAINT "cr_pricing_alerts_acknowledged_by_fk"
        FOREIGN KEY ("acknowledged_by") REFERENCES "neon_auth"."user"("id") ON DELETE SET NULL
);

CREATE INDEX "cr_pricing_alerts_property_idx" ON "cr_pricing_alerts" ("property_id");
CREATE INDEX "cr_pricing_alerts_alert_type_idx" ON "cr_pricing_alerts" ("alert_type");

-- Expansion Opportunities: areas where furnished premium > ops cost
CREATE TABLE "cr_expansion_opportunities" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "market_area_signal_id" uuid NOT NULL,

    -- Opportunity metrics
    "furnished_premium_eur" numeric(10, 2) NOT NULL,
    "estimated_ops_cost_eur" numeric(10, 2) NOT NULL,
    "net_opportunity_eur" numeric(10, 2) NOT NULL,
    "opportunity_score" numeric(5, 2) NOT NULL,

    -- Market conditions
    "supply_trend" text NOT NULL,
    "demand_trend" text NOT NULL,

    -- Recommendation
    "recommendation" text NOT NULL,
    "rationale" text,

    -- Status
    "is_reviewed" boolean DEFAULT false NOT NULL,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,

    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "expires_at" timestamp with time zone,

    CONSTRAINT "cr_expansion_opportunities_market_area_signal_id_fk"
        FOREIGN KEY ("market_area_signal_id") REFERENCES "cr_market_area_signals"("id") ON DELETE CASCADE,
    CONSTRAINT "cr_expansion_opportunities_reviewed_by_fk"
        FOREIGN KEY ("reviewed_by") REFERENCES "neon_auth"."user"("id") ON DELETE SET NULL
);

CREATE INDEX "cr_expansion_opportunities_recommendation_idx" ON "cr_expansion_opportunities" ("recommendation");
CREATE INDEX "cr_expansion_opportunities_score_idx" ON "cr_expansion_opportunities" ("opportunity_score" DESC);

-- Exit Timing Signals: rising supply + falling inquiry velocity
CREATE TABLE "cr_exit_timing_signals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "property_id" uuid,
    "market_area_signal_id" uuid NOT NULL,

    -- Signal metrics
    "supply_change_percent" numeric(5, 2) NOT NULL,
    "inquiry_velocity_change_percent" numeric(5, 2) NOT NULL,
    "price_decline_risk" text NOT NULL,

    -- Timing recommendation
    "exit_urgency" text NOT NULL,
    "projected_weeks_to_decline" integer,

    -- AI analysis
    "analysis_notes" text,

    "created_at" timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT "cr_exit_timing_signals_property_id_fk"
        FOREIGN KEY ("property_id") REFERENCES "cr_properties"("id") ON DELETE SET NULL,
    CONSTRAINT "cr_exit_timing_signals_market_area_signal_id_fk"
        FOREIGN KEY ("market_area_signal_id") REFERENCES "cr_market_area_signals"("id") ON DELETE CASCADE
);

CREATE INDEX "cr_exit_timing_signals_property_idx" ON "cr_exit_timing_signals" ("property_id");
CREATE INDEX "cr_exit_timing_signals_urgency_idx" ON "cr_exit_timing_signals" ("exit_urgency");
CREATE INDEX "cr_exit_timing_signals_risk_idx" ON "cr_exit_timing_signals" ("price_decline_risk");

-- Market Intelligence Reports: AI-generated analysis with human review gate
CREATE TABLE "cr_market_intelligence_reports" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "portfolio_id" uuid,
    "property_id" uuid,

    -- Report metadata
    "report_type" text NOT NULL,
    "title" text NOT NULL,

    -- Content (JSON)
    "summary" text NOT NULL,
    "insights" jsonb NOT NULL,
    "recommendations" jsonb NOT NULL,
    "metrics" jsonb NOT NULL,

    -- Data sources used
    "data_sources_used" jsonb,
    "signal_date_range" text,

    -- Governance - human gate before pricing automation
    "requires_review" boolean DEFAULT true NOT NULL,
    "reviewed_by" uuid,
    "reviewed_at" timestamp with time zone,
    "review_notes" text,

    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" uuid,

    CONSTRAINT "cr_market_intelligence_reports_portfolio_id_fk"
        FOREIGN KEY ("portfolio_id") REFERENCES "cr_portfolios"("id") ON DELETE SET NULL,
    CONSTRAINT "cr_market_intelligence_reports_property_id_fk"
        FOREIGN KEY ("property_id") REFERENCES "cr_properties"("id") ON DELETE SET NULL,
    CONSTRAINT "cr_market_intelligence_reports_reviewed_by_fk"
        FOREIGN KEY ("reviewed_by") REFERENCES "neon_auth"."user"("id") ON DELETE SET NULL,
    CONSTRAINT "cr_market_intelligence_reports_created_by_fk"
        FOREIGN KEY ("created_by") REFERENCES "neon_auth"."user"("id") ON DELETE SET NULL
);

CREATE INDEX "cr_market_intelligence_reports_portfolio_idx" ON "cr_market_intelligence_reports" ("portfolio_id");
CREATE INDEX "cr_market_intelligence_reports_property_idx" ON "cr_market_intelligence_reports" ("property_id");
CREATE INDEX "cr_market_intelligence_reports_type_idx" ON "cr_market_intelligence_reports" ("report_type");
CREATE INDEX "cr_market_intelligence_reports_pending_review_idx" ON "cr_market_intelligence_reports" ("requires_review") WHERE "requires_review" = true;
