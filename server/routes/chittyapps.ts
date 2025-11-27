import { Router, Request, Response } from 'express';
import {
  AuthorizationTier,
  captureAuthorizationHold,
  createAuthorizationHold,
  getChittyAppsMode,
  createLedgerEntry,
  getTierLimits,
  listReceptionEvents,
  listAuthorizationHolds,
  queryLedgerEntries,
  registerReceptionEvent,
  releaseAuthorizationHold,
  updateReceptionEventStatus,
} from '../services/chittyapps';

const router = Router();

router.get('/charge/tier-limits', (_req: Request, res: Response) => {
  res.json(getTierLimits());
});

router.get('/charge/holds', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const holds = await listAuthorizationHolds({
      status: req.query.status as any,
      propertyId: req.query.propertyId as string | undefined,
      tier: req.query.tier as AuthorizationTier | undefined,
    });

    res.json(holds);
  } catch (error) {
    console.error('Error listing authorization holds', error);
    res.status(500).json({ error: 'Unable to fetch authorization holds' });
  }
});

router.post('/charge/holds', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const hold = await createAuthorizationHold({
      amount: req.body.amount,
      currency: req.body.currency,
      tenantId: req.body.tenantId,
      propertyId: req.body.propertyId,
      tier: req.body.tier as AuthorizationTier,
      reference: req.body.reference,
    });

    res.json(hold);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create authorization hold';
    res.status(400).json({ error: message });
  }
});

router.post('/charge/holds/:holdId/capture', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const hold = await captureAuthorizationHold(req.params.holdId, req.body.captureAmount);
    res.json(hold);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to capture authorization hold';
    res.status(400).json({ error: message });
  }
});

router.post('/charge/holds/:holdId/release', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const hold = await releaseAuthorizationHold(req.params.holdId);
    res.json(hold);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to release authorization hold';
    res.status(400).json({ error: message });
  }
});

router.post('/ledger/entries', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const entry = await createLedgerEntry({
      propertyId: req.body.propertyId,
      category: req.body.category,
      amount: req.body.amount,
      currency: req.body.currency,
      description: req.body.description,
      referenceId: req.body.referenceId,
      metadata: req.body.metadata,
    });

    res.json(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create ledger entry';
    res.status(400).json({ error: message });
  }
});

router.get('/ledger/entries', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const entries = await queryLedgerEntries({
      propertyId: req.query.propertyId as string | undefined,
      category: req.query.category as string | undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
    });

    res.json(entries);
  } catch (error) {
    console.error('Error listing ledger entries', error);
    res.status(500).json({ error: 'Unable to fetch ledger entries' });
  }
});

router.post('/reception/events', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const event = await registerReceptionEvent({
      guestName: req.body.guestName,
      purpose: req.body.purpose,
      contactEmail: req.body.contactEmail,
      contactPhone: req.body.contactPhone,
      propertyId: req.body.propertyId,
      unitNumber: req.body.unitNumber,
      notes: req.body.notes,
    });

    res.json(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create reception event';
    res.status(400).json({ error: message });
  }
});

router.post('/reception/events/:eventId/status', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const event = await updateReceptionEventStatus(
      req.params.eventId,
      req.body.status,
      req.body.notes,
    );

    res.json(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update reception event';
    res.status(400).json({ error: message });
  }
});

router.get('/reception/events', async (req: Request, res: Response) => {
  try {
    res.setHeader('X-ChittyApps-Mode', getChittyAppsMode());
    const events = await listReceptionEvents({
      status: req.query.status as any,
      propertyId: req.query.propertyId as string | undefined,
    });

    res.json(events);
  } catch (error) {
    console.error('Error listing reception events', error);
    res.status(500).json({ error: 'Unable to fetch reception events' });
  }
});

export default router;
