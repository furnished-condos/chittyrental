import { openai } from './openai-client';
import { storage } from '../storage';
import type {
  MarketAreaSignal,
  InsertMarketAreaSignal,
  PricingAlert,
  InsertPricingAlert,
  ExpansionOpportunity,
  InsertExpansionOpportunity,
  ExitTimingSignal,
  InsertExitTimingSignal,
  MarketIntelligenceReport,
  InsertMarketIntelligenceReport,
  Property
} from '@shared/schema';

// ============================================================================
// MARKET INTELLIGENCE SERVICE
// Read-only signal ingestion for pricing & positioning intelligence
// No pricing automation without human gate
// ============================================================================

// Result interfaces
export interface PricingAnalysisResult {
  propertyId: number;
  propertyName: string;
  currentRentPerSqm: number;
  marketMedianPerSqm: number;
  deviationPercent: number;
  alertType: 'overpriced' | 'underpriced' | 'competitive' | 'premium_justified';
  marketBand: {
    p25: number;
    median: number;
    p75: number;
  };
  furnishedPremium: number | null;
  recommendation: string;
  justification: string | null;
}

export interface MarketTrendsResult {
  microArea: string;
  city: string;
  signalDate: Date;
  rentTrends: {
    medianFurnished: number | null;
    medianUnfurnished: number | null;
    furnishedPremiumPercent: number | null;
  };
  supplyMetrics: {
    newListingsWeekly: number | null;
    priceReductionFrequency: number | null;
    avgPriceReductionPercent: number | null;
  };
  demandMetrics: {
    medianDaysOnMarket: number | null;
    inquiryVelocityIndex: number | null;
    absorptionRate: number | null;
  };
  insights: string[];
}

export interface ExpansionScanResult {
  opportunities: Array<{
    microArea: string;
    city: string;
    furnishedPremiumEur: number;
    estimatedOpsCostEur: number;
    netOpportunityEur: number;
    opportunityScore: number;
    supplyTrend: 'increasing' | 'stable' | 'decreasing';
    demandTrend: 'increasing' | 'stable' | 'decreasing';
    recommendation: 'expand' | 'hold' | 'avoid';
    rationale: string;
  }>;
  summary: string;
}

export interface ExitTimingResult {
  propertyId: number | null;
  microArea: string;
  supplyChangePercent: number;
  inquiryVelocityChangePercent: number;
  priceDeclineRisk: 'low' | 'medium' | 'high' | 'critical';
  exitUrgency: 'none' | 'monitor' | 'prepare' | 'act_now';
  projectedWeeksToDecline: number | null;
  analysisNotes: string;
}

// ============================================================================
// SIGNAL INGESTION (Read-only dataset population)
// ============================================================================

/**
 * Ingest market area signals from external data source
 * No raw listings - aggregated signals only
 */
export async function ingestMarketAreaSignals(
  signals: InsertMarketAreaSignal[]
): Promise<MarketAreaSignal[]> {
  const results: MarketAreaSignal[] = [];

  for (const signal of signals) {
    const created = await storage.createMarketAreaSignal(signal);
    results.push(created);
  }

  return results;
}

/**
 * Get latest market signals for a micro-area
 */
export async function getMarketSignals(
  microArea: string,
  city?: string
): Promise<MarketAreaSignal[]> {
  return storage.getMarketAreaSignals(microArea, city);
}

/**
 * Get all market signals for a city
 */
export async function getMarketSignalsByCity(city: string): Promise<MarketAreaSignal[]> {
  return storage.getMarketAreaSignalsByCity(city);
}

// ============================================================================
// PRICING ANALYSIS
// Flag over/underpricing vs market bands
// ============================================================================

/**
 * Analyze property pricing against market signals
 * Returns pricing alert with justification options
 */
export async function analyzePricing(
  propertyId: number
): Promise<PricingAnalysisResult | null> {
  const property = await storage.getProperty(propertyId);
  if (!property) {
    throw new Error(`Property ${propertyId} not found`);
  }

  // Extract micro-area from property address (simplified)
  const microArea = extractMicroArea(property.address);
  const signals = await storage.getMarketAreaSignals(microArea);

  if (signals.length === 0) {
    return null; // No market data available
  }

  const latestSignal = signals[0]; // Most recent
  const sqm = property.squareFeet ? property.squareFeet * 0.092903 : 50; // Convert to sqm, default 50
  const currentRentPerSqm = Number(property.rentAmount) / sqm;
  const marketMedianPerSqm = Number(latestSignal.medianRentFurnished) || 0;

  if (marketMedianPerSqm === 0) {
    return null;
  }

  const deviationPercent = ((currentRentPerSqm - marketMedianPerSqm) / marketMedianPerSqm) * 100;

  // Determine alert type based on deviation
  let alertType: PricingAnalysisResult['alertType'];
  let recommendation: string;

  if (deviationPercent > 15) {
    alertType = 'overpriced';
    recommendation = 'Consider price reduction or document premium justification';
  } else if (deviationPercent < -15) {
    alertType = 'underpriced';
    recommendation = 'Opportunity to increase rent closer to market rate';
  } else {
    alertType = 'competitive';
    recommendation = 'Pricing is within competitive market band';
  }

  return {
    propertyId,
    propertyName: property.name,
    currentRentPerSqm,
    marketMedianPerSqm,
    deviationPercent,
    alertType,
    marketBand: {
      p25: Number(latestSignal.rentP25Furnished) || 0,
      median: marketMedianPerSqm,
      p75: Number(latestSignal.rentP75Furnished) || 0
    },
    furnishedPremium: latestSignal.furnishedPremiumPercent
      ? Number(latestSignal.furnishedPremiumPercent)
      : null,
    recommendation,
    justification: null
  };
}

/**
 * Create a pricing alert with optional justification
 * Requires human gate before any pricing automation
 */
export async function createPricingAlert(
  propertyId: number,
  justificationNotes?: string
): Promise<PricingAlert> {
  const analysis = await analyzePricing(propertyId);
  if (!analysis) {
    throw new Error('Cannot create alert - no market data available');
  }

  // If property is overpriced but justified, mark as premium_justified
  const alertType = (analysis.alertType === 'overpriced' && justificationNotes)
    ? 'premium_justified'
    : analysis.alertType;

  const property = await storage.getProperty(propertyId);
  if (!property) {
    throw new Error('Cannot create alert - property not found');
  }

  const signals = await storage.getMarketAreaSignals(
    extractMicroArea(property.address)
  );

  const alertData: InsertPricingAlert = {
    propertyId,
    marketAreaSignalId: signals[0]?.id || null,
    alertType,
    currentRentPerSqm: String(analysis.currentRentPerSqm),
    marketMedianPerSqm: String(analysis.marketMedianPerSqm),
    deviationPercent: String(analysis.deviationPercent),
    justificationNotes: justificationNotes || null,
    isAcknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null
  };

  return storage.createPricingAlert(alertData);
}

/**
 * Acknowledge a pricing alert (human gate)
 */
export async function acknowledgePricingAlert(
  alertId: number,
  userId: number
): Promise<PricingAlert> {
  return storage.updatePricingAlert(alertId, {
    isAcknowledged: true,
    acknowledgedBy: userId,
    acknowledgedAt: new Date()
  });
}

// ============================================================================
// MARKET TRENDS ANALYSIS
// ============================================================================

/**
 * Get market trends for a specific area
 */
export async function getMarketTrends(
  microArea: string,
  city?: string
): Promise<MarketTrendsResult | null> {
  const signals = await storage.getMarketAreaSignals(microArea, city);

  if (signals.length === 0) {
    return null;
  }

  const latestSignal = signals[0];

  // Generate AI insights
  const insights = await generateMarketInsights(latestSignal);

  return {
    microArea: latestSignal.microArea,
    city: latestSignal.city,
    signalDate: latestSignal.signalDate,
    rentTrends: {
      medianFurnished: latestSignal.medianRentFurnished
        ? Number(latestSignal.medianRentFurnished)
        : null,
      medianUnfurnished: latestSignal.medianRentUnfurnished
        ? Number(latestSignal.medianRentUnfurnished)
        : null,
      furnishedPremiumPercent: latestSignal.furnishedPremiumPercent
        ? Number(latestSignal.furnishedPremiumPercent)
        : null
    },
    supplyMetrics: {
      newListingsWeekly: latestSignal.newListingsWeekly,
      priceReductionFrequency: latestSignal.priceReductionFrequency
        ? Number(latestSignal.priceReductionFrequency)
        : null,
      avgPriceReductionPercent: latestSignal.avgPriceReductionPercent
        ? Number(latestSignal.avgPriceReductionPercent)
        : null
    },
    demandMetrics: {
      medianDaysOnMarket: latestSignal.medianDaysOnMarket,
      inquiryVelocityIndex: latestSignal.inquiryVelocityIndex
        ? Number(latestSignal.inquiryVelocityIndex)
        : null,
      absorptionRate: latestSignal.absorptionRate
        ? Number(latestSignal.absorptionRate)
        : null
    },
    insights
  };
}

// ============================================================================
// EXPANSION OPPORTUNITY DETECTION
// Areas where furnished premium > ops cost
// ============================================================================

/**
 * Scan for expansion opportunities across all tracked markets
 */
export async function scanExpansionOpportunities(
  estimatedOpsCostPerUnit: number = 500 // Default monthly ops cost in EUR
): Promise<ExpansionScanResult> {
  const allSignals = await storage.getAllMarketAreaSignals();
  const opportunities: ExpansionScanResult['opportunities'] = [];

  for (const signal of allSignals) {
    if (!signal.medianRentFurnished || !signal.medianRentUnfurnished) {
      continue;
    }

    const furnishedPremiumEur =
      (Number(signal.medianRentFurnished) - Number(signal.medianRentUnfurnished)) * 50; // Assume 50sqm avg
    const netOpportunity = furnishedPremiumEur - estimatedOpsCostPerUnit;

    // Calculate opportunity score (0-100)
    let opportunityScore = 50; // Base score

    // Adjust based on metrics
    if (signal.inquiryVelocityIndex && Number(signal.inquiryVelocityIndex) > 1) {
      opportunityScore += 15;
    }
    if (signal.absorptionRate && Number(signal.absorptionRate) > 10) {
      opportunityScore += 10;
    }
    if (netOpportunity > 200) {
      opportunityScore += 15;
    }
    if (signal.medianDaysOnMarket && signal.medianDaysOnMarket < 30) {
      opportunityScore += 10;
    }

    // Determine trends
    const supplyTrend = determineSupplyTrend(signal);
    const demandTrend = determineDemandTrend(signal);

    // Determine recommendation
    let recommendation: 'expand' | 'hold' | 'avoid';
    if (netOpportunity > 100 && demandTrend !== 'decreasing' && opportunityScore >= 60) {
      recommendation = 'expand';
    } else if ((netOpportunity < 0) || (supplyTrend === 'increasing' && demandTrend === 'decreasing')) {
      recommendation = 'avoid';
    } else {
      recommendation = 'hold';
    }

    opportunities.push({
      microArea: signal.microArea,
      city: signal.city,
      furnishedPremiumEur,
      estimatedOpsCostEur: estimatedOpsCostPerUnit,
      netOpportunityEur: netOpportunity,
      opportunityScore: Math.min(100, Math.max(0, opportunityScore)),
      supplyTrend,
      demandTrend,
      recommendation,
      rationale: generateOpportunityRationale(signal, netOpportunity, recommendation)
    });
  }

  // Sort by opportunity score descending
  opportunities.sort((a, b) => b.opportunityScore - a.opportunityScore);

  const expandCount = opportunities.filter(o => o.recommendation === 'expand').length;
  const summary = `Found ${opportunities.length} markets analyzed. ${expandCount} recommended for expansion.`;

  return { opportunities, summary };
}

/**
 * Record an expansion opportunity for tracking
 */
export async function recordExpansionOpportunity(
  opportunity: Omit<InsertExpansionOpportunity, 'createdAt'>
): Promise<ExpansionOpportunity> {
  return storage.createExpansionOpportunity(opportunity);
}

// ============================================================================
// EXIT TIMING SIGNALS
// Rising supply + falling inquiry velocity
// ============================================================================

/**
 * Analyze exit timing for a property or market area
 */
export async function analyzeExitTiming(
  propertyId?: number,
  microArea?: string
): Promise<ExitTimingResult | null> {
  let targetMicroArea = microArea;

  if (propertyId) {
    const property = await storage.getProperty(propertyId);
    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }
    targetMicroArea = extractMicroArea(property.address);
  }

  if (!targetMicroArea) {
    throw new Error('Either propertyId or microArea must be provided');
  }

  // Get historical signals for trend analysis (would need multiple data points)
  const signals = await storage.getMarketAreaSignals(targetMicroArea);

  if (signals.length === 0) {
    return null;
  }

  const latestSignal = signals[0];

  // Calculate change metrics.
  // Prefer real historical comparison when a previous signal exists; otherwise,
  // fall back to simple heuristic placeholders based on the latest snapshot only.
  let supplyChangePercent = 0;
  let inquiryVelocityChangePercent = 0;

  const previousSignal = signals[1];

  if (previousSignal) {
    const latestSupply = latestSignal.newListingsWeekly ?? 0;
    const previousSupply = previousSignal.newListingsWeekly ?? 0;

    if (previousSupply > 0) {
      supplyChangePercent =
        ((latestSupply - previousSupply) / previousSupply) * 100;
    } else if (latestSupply > 0) {
      // No meaningful baseline; treat any new listings as a large positive change.
      supplyChangePercent = 100;
    }

    const latestInquiryIndex = Number(latestSignal.inquiryVelocityIndex ?? 0);
    const previousInquiryIndex = Number(previousSignal.inquiryVelocityIndex ?? 0);

    if (previousInquiryIndex !== 0) {
      inquiryVelocityChangePercent =
        ((latestInquiryIndex - previousInquiryIndex) / previousInquiryIndex) * 100;
    } else if (latestInquiryIndex !== 0) {
      // No meaningful baseline; treat any movement away from zero as a large change.
      inquiryVelocityChangePercent = latestInquiryIndex > 0 ? 100 : -100;
    }
  } else {
    // Fallback: insufficient history to compute a true trend, so use heuristic
    // placeholders based on the latest snapshot only.
    if (latestSignal.newListingsWeekly) {
      supplyChangePercent = latestSignal.newListingsWeekly > 20 ? 15 : 0;
    }

    if (latestSignal.inquiryVelocityIndex != null) {
      inquiryVelocityChangePercent =
        Number(latestSignal.inquiryVelocityIndex) < 0.8 ? -20 : 5;
    }
  }
  // Determine risk level
  let priceDeclineRisk: ExitTimingResult['priceDeclineRisk'];
  let exitUrgency: ExitTimingResult['exitUrgency'];
  let projectedWeeksToDecline: number | null = null;

  if (supplyChangePercent > 10 && inquiryVelocityChangePercent < -15) {
    priceDeclineRisk = 'critical';
    exitUrgency = 'act_now';
    projectedWeeksToDecline = 4;
  } else if (supplyChangePercent > 5 && inquiryVelocityChangePercent < -10) {
    priceDeclineRisk = 'high';
    exitUrgency = 'prepare';
    projectedWeeksToDecline = 8;
  } else if (supplyChangePercent > 0 && inquiryVelocityChangePercent < 0) {
    priceDeclineRisk = 'medium';
    exitUrgency = 'monitor';
    projectedWeeksToDecline = 12;
  } else {
    priceDeclineRisk = 'low';
    exitUrgency = 'none';
  }

  const analysisNotes = generateExitTimingNotes(
    latestSignal,
    supplyChangePercent,
    inquiryVelocityChangePercent,
    priceDeclineRisk
  );

  return {
    propertyId: propertyId || null,
    microArea: targetMicroArea,
    supplyChangePercent,
    inquiryVelocityChangePercent,
    priceDeclineRisk,
    exitUrgency,
    projectedWeeksToDecline,
    analysisNotes
  };
}

/**
 * Record an exit timing signal
 */
export async function recordExitTimingSignal(
  signal: Omit<InsertExitTimingSignal, 'createdAt'>
): Promise<ExitTimingSignal> {
  return storage.createExitTimingSignal(signal);
}

// ============================================================================
// MARKET INTELLIGENCE REPORTS
// AI-generated analysis with human review gate
// ============================================================================

/**
 * Generate a comprehensive market intelligence report
 */
export async function generateMarketIntelligenceReport(
  reportType: MarketIntelligenceReport['reportType'],
  options: {
    businessAccountId?: number;
    propertyId?: number;
    microArea?: string;
    city?: string;
  }
): Promise<MarketIntelligenceReport> {
  let reportData: {
    summary: string;
    insights: string[];
    recommendations: string[];
    metrics: Record<string, number | string>;
    dataSourcesUsed: string[];
  };

  switch (reportType) {
    case 'pricing_analysis':
      reportData = await generatePricingReport(options);
      break;
    case 'market_trends':
      reportData = await generateTrendsReport(options);
      break;
    case 'expansion_scan':
      reportData = await generateExpansionReport(options);
      break;
    case 'exit_timing':
      reportData = await generateExitTimingReport(options);
      break;
    case 'competitive_position':
      reportData = await generateCompetitiveReport(options);
      break;
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }

  const reportRecord: InsertMarketIntelligenceReport = {
    businessAccountId: options.businessAccountId || null,
    propertyId: options.propertyId || null,
    reportType,
    title: `${formatReportType(reportType)} - ${new Date().toISOString().split('T')[0]}`,
    summary: reportData.summary,
    insights: JSON.stringify(reportData.insights),
    recommendations: JSON.stringify(reportData.recommendations),
    metrics: JSON.stringify(reportData.metrics),
    dataSourcesUsed: reportData.dataSourcesUsed,
    signalDateRange: null,
    requiresReview: true, // Human gate enforced
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    createdBy: null
  };

  return storage.createMarketIntelligenceReport(reportRecord);
}

/**
 * Review and approve a market intelligence report (human gate)
 */
export async function reviewMarketIntelligenceReport(
  reportId: number,
  userId: number,
  reviewNotes?: string
): Promise<MarketIntelligenceReport> {
  return storage.updateMarketIntelligenceReport(reportId, {
    requiresReview: false,
    reviewedBy: userId,
    reviewedAt: new Date(),
    reviewNotes: reviewNotes || null
  });
}

/**
 * Get pending reports requiring review
 */
export async function getPendingReports(): Promise<MarketIntelligenceReport[]> {
  return storage.getMarketIntelligenceReportsPendingReview();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Attempt to extract a "micro area" (e.g., neighborhood or district) from a free-form address.
 *
 * NOTE: This uses a very naive heuristic and is not suitable for production-grade
 * geospatial logic. For reliable results, integrate with a proper geocoding service
 * and derive micro-areas from structured location data.
 */
function extractMicroArea(address: string): string {
  const parts = address.split(',');
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2].trim();

    // Basic validation: avoid returning clearly invalid or empty segments.
    const isEmpty = candidate.length === 0;
    const isTooShort = candidate.length < 2;
    const isMostlyNumeric = /^[0-9\s-]+$/.test(candidate);

    if (!isEmpty && !isTooShort && !isMostlyNumeric) {
      return candidate;
    }
  }

  // Fallback: if we cannot confidently extract a micro area, return the full address.
  return address;
}

function determineSupplyTrend(
  signal: MarketAreaSignal
): 'increasing' | 'stable' | 'decreasing' {
  if (!signal.newListingsWeekly) return 'stable';
  if (signal.newListingsWeekly > 25) return 'increasing';
  if (signal.newListingsWeekly < 10) return 'decreasing';
  return 'stable';
}

function determineDemandTrend(
  signal: MarketAreaSignal
): 'increasing' | 'stable' | 'decreasing' {
  if (!signal.inquiryVelocityIndex) return 'stable';
  const idx = Number(signal.inquiryVelocityIndex);
  if (idx > 1.2) return 'increasing';
  if (idx < 0.8) return 'decreasing';
  return 'stable';
}

function generateOpportunityRationale(
  signal: MarketAreaSignal,
  netOpportunity: number,
  recommendation: 'expand' | 'hold' | 'avoid'
): string {
  const parts: string[] = [];

  if (recommendation === 'expand') {
    parts.push(`Net opportunity of €${netOpportunity.toFixed(0)}/month per unit.`);
    if (signal.medianDaysOnMarket && signal.medianDaysOnMarket < 30) {
      parts.push('Fast absorption indicates strong demand.');
    }
  } else if (recommendation === 'avoid') {
    if (netOpportunity < 0) {
      parts.push('Furnished premium does not cover operating costs.');
    }
    if (signal.priceReductionFrequency && Number(signal.priceReductionFrequency) > 20) {
      parts.push('High rate of price reductions suggests oversupply.');
    }
  } else {
    parts.push('Market conditions are mixed - monitor for changes.');
  }

  return parts.join(' ');
}

function generateExitTimingNotes(
  signal: MarketAreaSignal,
  supplyChange: number,
  inquiryChange: number,
  risk: ExitTimingResult['priceDeclineRisk']
): string {
  const notes: string[] = [];

  if (risk === 'critical' || risk === 'high') {
    notes.push(`Warning: ${signal.microArea} showing concerning trends.`);
    if (supplyChange > 10) {
      notes.push(`New supply up ${supplyChange.toFixed(0)}% - market flooding risk.`);
    }
    if (inquiryChange < -10) {
      notes.push(`Inquiry velocity down ${Math.abs(inquiryChange).toFixed(0)}% - demand weakening.`);
    }
  } else if (risk === 'medium') {
    notes.push('Early warning signs present - increased monitoring recommended.');
  } else {
    notes.push('Market conditions stable - no immediate exit pressure.');
  }

  return notes.join(' ');
}

async function generateMarketInsights(signal: MarketAreaSignal): Promise<string[]> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a real estate market analyst providing concise, actionable insights.'
        },
        {
          role: 'user',
          content: `Generate 3-5 brief market insights based on these signals for ${signal.microArea}, ${signal.city}:

          Median Rent (Furnished): €${signal.medianRentFurnished}/sqm
          Median Rent (Unfurnished): €${signal.medianRentUnfurnished}/sqm
          Furnished Premium: ${signal.furnishedPremiumPercent}%
          Days on Market: ${signal.medianDaysOnMarket}
          New Listings Weekly: ${signal.newListingsWeekly}
          Price Reduction Rate: ${signal.priceReductionFrequency}%

          Return a JSON array of insight strings.`
        }
      ],
      model: 'gpt-3.5-turbo',
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0].message.content || '{"insights":[]}');
    return result.insights || [];
  } catch (error) {
    console.error('Error generating market insights:', error);
    return ['Market data available but AI analysis temporarily unavailable.'];
  }
}

async function generatePricingReport(options: {
  propertyId?: number;
  microArea?: string;
}): Promise<{
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: Record<string, number | string>;
  dataSourcesUsed: string[];
}> {
  if (options.propertyId) {
    const analysis = await analyzePricing(options.propertyId);
    if (analysis) {
      return {
        summary: `Pricing analysis for ${analysis.propertyName}: ${analysis.alertType}`,
        insights: [
          `Current rent is ${analysis.deviationPercent.toFixed(1)}% ${analysis.deviationPercent > 0 ? 'above' : 'below'} market median`,
          `Market band: €${analysis.marketBand.p25.toFixed(2)} - €${analysis.marketBand.p75.toFixed(2)}/sqm`
        ],
        recommendations: [analysis.recommendation],
        metrics: {
          currentRentPerSqm: analysis.currentRentPerSqm,
          marketMedianPerSqm: analysis.marketMedianPerSqm,
          deviationPercent: analysis.deviationPercent
        },
        dataSourcesUsed: ['market_area_signals']
      };
    }
  }

  return {
    summary: 'Insufficient data for pricing analysis',
    insights: [],
    recommendations: ['Collect more market data for this area'],
    metrics: {},
    dataSourcesUsed: []
  };
}

async function generateTrendsReport(options: {
  microArea?: string;
  city?: string;
}): Promise<{
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: Record<string, number | string>;
  dataSourcesUsed: string[];
}> {
  if (options.microArea) {
    const trends = await getMarketTrends(options.microArea, options.city);
    if (trends) {
      return {
        summary: `Market trends for ${trends.microArea}, ${trends.city}`,
        insights: trends.insights,
        recommendations: [],
        metrics: {
          medianFurnished: trends.rentTrends.medianFurnished || 0,
          medianUnfurnished: trends.rentTrends.medianUnfurnished || 0,
          daysOnMarket: trends.demandMetrics.medianDaysOnMarket || 0
        },
        dataSourcesUsed: ['market_area_signals']
      };
    }
  }

  return {
    summary: 'No trend data available',
    insights: [],
    recommendations: [],
    metrics: {},
    dataSourcesUsed: []
  };
}

async function generateExpansionReport(options: {
  city?: string;
}): Promise<{
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: Record<string, number | string>;
  dataSourcesUsed: string[];
}> {
  const scan = await scanExpansionOpportunities();
  const topOpportunities = scan.opportunities.slice(0, 5);

  return {
    summary: scan.summary,
    insights: topOpportunities.map(o =>
      `${o.microArea}: ${o.recommendation} (score: ${o.opportunityScore})`
    ),
    recommendations: topOpportunities
      .filter(o => o.recommendation === 'expand')
      .map(o => o.rationale),
    metrics: {
      totalMarketsAnalyzed: scan.opportunities.length,
      expandRecommendations: scan.opportunities.filter(o => o.recommendation === 'expand').length,
      avoidRecommendations: scan.opportunities.filter(o => o.recommendation === 'avoid').length
    },
    dataSourcesUsed: ['market_area_signals']
  };
}

async function generateExitTimingReport(options: {
  propertyId?: number;
  microArea?: string;
}): Promise<{
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: Record<string, number | string>;
  dataSourcesUsed: string[];
}> {
  const timing = await analyzeExitTiming(options.propertyId, options.microArea);

  if (timing) {
    return {
      summary: `Exit timing analysis: ${timing.exitUrgency} urgency, ${timing.priceDeclineRisk} risk`,
      insights: [timing.analysisNotes],
      recommendations: timing.exitUrgency === 'act_now'
        ? ['Immediate action recommended - prepare exit strategy']
        : timing.exitUrgency === 'prepare'
        ? ['Begin exit preparation - market showing weakness']
        : [],
      metrics: {
        supplyChangePercent: timing.supplyChangePercent,
        inquiryVelocityChangePercent: timing.inquiryVelocityChangePercent,
        projectedWeeksToDecline: timing.projectedWeeksToDecline || 0
      },
      dataSourcesUsed: ['market_area_signals']
    };
  }

  return {
    summary: 'No exit timing data available',
    insights: [],
    recommendations: [],
    metrics: {},
    dataSourcesUsed: []
  };
}

async function generateCompetitiveReport(options: {
  propertyId?: number;
  microArea?: string;
  city?: string;
}): Promise<{
  summary: string;
  insights: string[];
  recommendations: string[];
  metrics: Record<string, number | string>;
  dataSourcesUsed: string[];
}> {
  const trends = options.microArea
    ? await getMarketTrends(options.microArea, options.city)
    : null;

  if (trends) {
    const furnishedPremium = trends.rentTrends.furnishedPremiumPercent || 0;
    return {
      summary: `Competitive position in ${trends.microArea}`,
      insights: [
        `Furnished premium in market: ${furnishedPremium.toFixed(1)}%`,
        `Average time to lease: ${trends.demandMetrics.medianDaysOnMarket || 'N/A'} days`
      ],
      recommendations: furnishedPremium > 30
        ? ['Strong furnished market - maintain premium positioning']
        : ['Consider value-add amenities to justify premium'],
      metrics: {
        furnishedPremiumPercent: furnishedPremium,
        medianDaysOnMarket: trends.demandMetrics.medianDaysOnMarket || 0
      },
      dataSourcesUsed: ['market_area_signals']
    };
  }

  return {
    summary: 'Insufficient data for competitive analysis',
    insights: [],
    recommendations: [],
    metrics: {},
    dataSourcesUsed: []
  };
}

function formatReportType(type: string): string {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
