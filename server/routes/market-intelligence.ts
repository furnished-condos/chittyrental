import { Router } from 'express';
import { storage } from '../storage';
import {
  ingestMarketAreaSignals,
  getMarketSignals,
  getMarketSignalsByCity,
  analyzePricing,
  createPricingAlert,
  acknowledgePricingAlert,
  getMarketTrends,
  scanExpansionOpportunities,
  recordExpansionOpportunity,
  analyzeExitTiming,
  recordExitTimingSignal,
  generateMarketIntelligenceReport,
  reviewMarketIntelligenceReport,
  getPendingReports
} from '../services/market-intelligence';
import type { InsertMarketAreaSignal } from '@shared/schema';

const router = Router();

// ============================================================================
// MARKET AREA SIGNALS (Read-only dataset ingestion)
// ============================================================================

/**
 * Ingest market area signals from external data source
 * POST /api/market-intelligence/signals
 */
router.post('/signals', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const signals: InsertMarketAreaSignal[] = req.body.signals;

    if (!signals || !Array.isArray(signals)) {
      return res.status(400).json({ error: 'signals array is required' });
    }

    if (signals.length === 0) {
      return res.status(400).json({ error: 'signals array cannot be empty' });
    }
    const created = await ingestMarketAreaSignals(signals);
    res.status(201).json({ count: created.length, signals: created });
  } catch (error) {
    console.error('Error ingesting market signals:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get market signals for a micro-area
 * GET /api/market-intelligence/signals/:microArea
 */
router.get('/signals/:microArea', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { microArea } = req.params;
    const { city } = req.query;

    const signals = await getMarketSignals(microArea, city as string | undefined);
    res.json(signals);
  } catch (error) {
    console.error('Error fetching market signals:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get all market signals for a city
 * GET /api/market-intelligence/signals/city/:city
 */
router.get('/signals/city/:city', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { city } = req.params;
    const signals = await getMarketSignalsByCity(city);
    res.json(signals);
  } catch (error) {
    console.error('Error fetching city signals:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get all market signals
 * GET /api/market-intelligence/signals
 */
router.get('/signals', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const signals = await storage.getAllMarketAreaSignals();
    res.json(signals);
  } catch (error) {
    console.error('Error fetching all signals:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// ============================================================================
// PRICING ANALYSIS
// ============================================================================

/**
 * Analyze pricing for a property
 * GET /api/market-intelligence/pricing/:propertyId
 */
router.get('/pricing/:propertyId', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const propertyId = parseInt(req.params.propertyId);
    const analysis = await analyzePricing(propertyId);

    if (!analysis) {
      return res.status(404).json({ error: 'No market data available for this property area' });
    }

    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing pricing:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Create a pricing alert for a property
 * POST /api/market-intelligence/pricing/alerts
 */
router.post('/pricing/alerts', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { propertyId, justificationNotes } = req.body;

    if (!propertyId) {
      return res.status(400).json({ error: 'propertyId is required' });
    }

    const alert = await createPricingAlert(propertyId, justificationNotes);
    res.status(201).json(alert);
  } catch (error) {
    console.error('Error creating pricing alert:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get pricing alerts
 * GET /api/market-intelligence/pricing/alerts
 */
router.get('/pricing/alerts', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { propertyId } = req.query;
    const alerts = await storage.getPricingAlerts(
      propertyId ? parseInt(propertyId as string) : undefined
    );
    res.json(alerts);
  } catch (error) {
    console.error('Error fetching pricing alerts:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Acknowledge a pricing alert (human gate)
 * POST /api/market-intelligence/pricing/alerts/:alertId/acknowledge
 */
router.post('/pricing/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const alertId = parseInt(req.params.alertId);
    const userId = (req.user as { id: number }).id;

    const alert = await acknowledgePricingAlert(alertId, userId);
    res.json(alert);
  } catch (error) {
    console.error('Error acknowledging pricing alert:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// ============================================================================
// MARKET TRENDS
// ============================================================================

/**
 * Get market trends for a micro-area
 * GET /api/market-intelligence/trends/:microArea
 */
router.get('/trends/:microArea', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { microArea } = req.params;
    const { city } = req.query;

    const trends = await getMarketTrends(microArea, city as string | undefined);

    if (!trends) {
      return res.status(404).json({ error: 'No trend data available for this area' });
    }

    res.json(trends);
  } catch (error) {
    console.error('Error fetching market trends:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// ============================================================================
// EXPANSION OPPORTUNITIES
// ============================================================================

/**
 * Scan for expansion opportunities
 * GET /api/market-intelligence/expansion/scan
 */
router.get('/expansion/scan', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { opsCost } = req.query;
    const estimatedOpsCost = opsCost ? parseFloat(opsCost as string) : undefined;

    if (estimatedOpsCost !== undefined && isNaN(estimatedOpsCost)) {
      return res.status(400).json({ error: 'opsCost must be a valid number' });
    }
    const scan = await scanExpansionOpportunities(estimatedOpsCost);
    res.json(scan);
  } catch (error) {
    console.error('Error scanning expansion opportunities:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Record an expansion opportunity
 * POST /api/market-intelligence/expansion/opportunities
 */
router.post('/expansion/opportunities', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const opportunity = await recordExpansionOpportunity(req.body);
    res.status(201).json(opportunity);
  } catch (error) {
    console.error('Error recording expansion opportunity:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get expansion opportunities
 * GET /api/market-intelligence/expansion/opportunities
 */
router.get('/expansion/opportunities', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { reviewed } = req.query;
    const opportunities = await storage.getExpansionOpportunities(
      reviewed !== undefined ? reviewed === 'true' : undefined
    );
    res.json(opportunities);
  } catch (error) {
    console.error('Error fetching expansion opportunities:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Review an expansion opportunity (human gate)
 * POST /api/market-intelligence/expansion/opportunities/:id/review
 */
router.post('/expansion/opportunities/:id/review', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const id = parseInt(req.params.id);
    const userId = (req.user as { id: number }).id;

    const opportunity = await storage.updateExpansionOpportunity(id, {
      isReviewed: true,
      reviewedBy: userId,
      reviewedAt: new Date()
    });
    res.json(opportunity);
  } catch (error) {
    console.error('Error reviewing expansion opportunity:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// ============================================================================
// EXIT TIMING
// ============================================================================

/**
 * Analyze exit timing for a property or area
 * GET /api/market-intelligence/exit-timing
 */
router.get('/exit-timing', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { propertyId, microArea } = req.query;

    const timing = await analyzeExitTiming(
      propertyId ? parseInt(propertyId as string) : undefined,
      microArea as string | undefined
    );

    if (!timing) {
      return res.status(404).json({ error: 'No exit timing data available' });
    }

    res.json(timing);
  } catch (error) {
    console.error('Error analyzing exit timing:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Record an exit timing signal
 * POST /api/market-intelligence/exit-timing/signals
 */
router.post('/exit-timing/signals', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const signal = await recordExitTimingSignal(req.body);
    res.status(201).json(signal);
  } catch (error) {
    console.error('Error recording exit timing signal:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get exit timing signals
 * GET /api/market-intelligence/exit-timing/signals
 */
router.get('/exit-timing/signals', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { propertyId } = req.query;
    const signals = await storage.getExitTimingSignals(
      propertyId ? parseInt(propertyId as string) : undefined
    );
    res.json(signals);
  } catch (error) {
    console.error('Error fetching exit timing signals:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

// ============================================================================
// MARKET INTELLIGENCE REPORTS
// ============================================================================

/**
 * Generate a market intelligence report
 * POST /api/market-intelligence/reports/generate
 */
router.post('/reports/generate', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { reportType, businessAccountId, propertyId, microArea, city } = req.body;

    if (!reportType) {
      return res.status(400).json({ error: 'reportType is required' });
    }

    const report = await generateMarketIntelligenceReport(reportType, {
      businessAccountId,
      propertyId,
      microArea,
      city
    });

    res.status(201).json(report);
  } catch (error) {
    console.error('Error generating MI report:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get market intelligence reports
 * GET /api/market-intelligence/reports
 */
router.get('/reports', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { businessAccountId } = req.query;
    const reports = await storage.getMarketIntelligenceReports(
      businessAccountId ? parseInt(businessAccountId as string) : undefined
    );
    res.json(reports);
  } catch (error) {
    console.error('Error fetching MI reports:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Get pending reports requiring review
 * GET /api/market-intelligence/reports/pending
 */
router.get('/reports/pending', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const reports = await getPendingReports();
    res.json(reports);
  } catch (error) {
    console.error('Error fetching pending reports:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * Review a market intelligence report (human gate)
 * POST /api/market-intelligence/reports/:reportId/review
 */
router.post('/reports/:reportId/review', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const reportId = parseInt(req.params.reportId);
    const userId = (req.user as { id: number }).id;
    const { reviewNotes } = req.body;

    const report = await reviewMarketIntelligenceReport(reportId, userId, reviewNotes);
    res.json(report);
  } catch (error) {
    console.error('Error reviewing MI report:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

export default router;
