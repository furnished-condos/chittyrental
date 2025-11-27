import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';

export type AuthorizationTier = 'NEW_GUEST' | 'VERIFIED_GUEST' | 'PREMIUM_PROPERTY';

export interface AuthorizationHold {
  id: string;
  tenantId?: string;
  propertyId?: string;
  amount: number;
  currency: string;
  tier: AuthorizationTier;
  status: 'created' | 'captured' | 'released';
  createdAt: string;
  capturedAt?: string;
  releasedAt?: string;
  captureAmount?: number;
  reference?: string;
}

export interface LedgerEntry {
  id: string;
  propertyId?: string;
  category: string;
  amount: number;
  currency: string;
  description?: string;
  referenceId?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type ReceptionEventStatus = 'queued' | 'in_progress' | 'completed' | 'cancelled';

export interface ReceptionEvent {
  id: string;
  guestName: string;
  contactEmail?: string;
  contactPhone?: string;
  propertyId?: string;
  unitNumber?: string;
  purpose: string;
  status: ReceptionEventStatus;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export type ChittyAppsMode = 'live' | 'mock';

interface ChittyAppsConfig {
  mode: ChittyAppsMode;
  baseUrl?: string;
  apiKey?: string;
  allowMockFallback?: boolean;
}

const TIER_LIMITS: Record<AuthorizationTier, number> = {
  NEW_GUEST: 2500,
  VERIFIED_GUEST: 5000,
  PREMIUM_PROPERTY: 10000,
};

function generateId(prefix: string): string {
  return `${prefix}_${uuidv4()}`;
}

function enforceTierLimit(amount: number, tier: AuthorizationTier): void {
  const limit = TIER_LIMITS[tier];
  if (amount > limit) {
    throw new Error(`Amount exceeds ${tier} tier limit of $${limit.toLocaleString()}`);
  }
}

class ChittyAppsService {
  private mode: ChittyAppsMode;
  private client?: AxiosInstance;
  private allowMockFallback: boolean;

  private holds: AuthorizationHold[] = [];
  private ledgerEntries: LedgerEntry[] = [];
  private receptionQueue: ReceptionEvent[] = [];

  constructor(config?: Partial<ChittyAppsConfig>) {
    const envMode = (process.env.CHITTYAPPS_MODE ?? '').toLowerCase();
    const requestedMode: ChittyAppsMode = config?.mode ?? (envMode === 'live' ? 'live' : 'mock');
    const baseUrl = config?.baseUrl ?? process.env.CHITTYAPPS_BASE_URL;
    const apiKey = config?.apiKey ?? process.env.CHITTYAPPS_API_KEY;

    this.allowMockFallback = config?.allowMockFallback ?? process.env.CHITTYAPPS_ALLOW_MOCK_FALLBACK !== 'false';

    if (requestedMode === 'live' && baseUrl && apiKey) {
      this.mode = 'live';
      this.client = axios.create({
        baseURL: baseUrl.replace(/\/$/, ''),
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 10_000,
      });
    } else {
      if (requestedMode === 'live') {
        console.warn(
          '[chittyapps] Live mode requested but CHITTYAPPS_BASE_URL or CHITTYAPPS_API_KEY is missing. Falling back to mock mode.',
        );
      }
      this.mode = 'mock';
    }
  }

  getMode(): ChittyAppsMode {
    return this.mode;
  }

  private async withOptionalFallback<T>(liveCall: () => Promise<T>, mockCall: () => Promise<T>): Promise<T> {
    if (this.mode === 'live' && this.client) {
      try {
        return await liveCall();
      } catch (error) {
        if (!this.allowMockFallback) {
          throw error instanceof Error
            ? error
            : new Error('ChittyApps live call failed and mock fallback is disabled');
        }

        console.warn('[chittyapps] Live call failed, using mock implementation instead', error);
      }
    }

    return mockCall();
  }

  async createAuthorizationHold({
    amount,
    currency = 'USD',
    tenantId,
    propertyId,
    tier = 'NEW_GUEST',
    reference,
  }: {
    amount: number;
    currency?: string;
    tenantId?: string;
    propertyId?: string;
    tier?: AuthorizationTier;
    reference?: string;
  }): Promise<AuthorizationHold> {
    enforceTierLimit(amount, tier);

    return this.withOptionalFallback(async () => {
      const response = await this.client!.post<AuthorizationHold>('/charge/holds', {
        amount,
        currency,
        tenantId,
        propertyId,
        tier,
        reference,
      });
      return response.data;
    }, async () => {
      const hold: AuthorizationHold = {
        id: generateId('hold'),
        amount,
        currency,
        tenantId,
        propertyId,
        tier,
        status: 'created',
        reference,
        createdAt: new Date().toISOString(),
      };

      this.holds.push(hold);
      return hold;
    });
  }

  async listAuthorizationHolds(filters: {
    status?: AuthorizationHold['status'];
    propertyId?: string;
    tier?: AuthorizationTier;
  } = {}): Promise<AuthorizationHold[]> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.get<AuthorizationHold[]>('/charge/holds', {
        params: filters,
      });
      return response.data;
    }, async () => {
      return this.holds.filter((hold) => {
        if (filters.status && hold.status !== filters.status) return false;
        if (filters.propertyId && hold.propertyId !== filters.propertyId) return false;
        if (filters.tier && hold.tier !== filters.tier) return false;
        return true;
      });
    });
  }

  async captureAuthorizationHold(holdId: string, captureAmount?: number): Promise<AuthorizationHold> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.post<AuthorizationHold>(`/charge/holds/${holdId}/capture`, {
        captureAmount,
      });
      return response.data;
    }, async () => {
      const hold = this.holds.find((h) => h.id === holdId);
      if (!hold) {
        throw new Error('Authorization hold not found');
      }

      if (hold.status === 'released') {
        throw new Error('Cannot capture a released authorization hold');
      }

      hold.status = 'captured';
      hold.captureAmount = captureAmount ?? hold.amount;
      hold.capturedAt = new Date().toISOString();

      return hold;
    });
  }

  async releaseAuthorizationHold(holdId: string): Promise<AuthorizationHold> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.post<AuthorizationHold>(`/charge/holds/${holdId}/release`);
      return response.data;
    }, async () => {
      const hold = this.holds.find((h) => h.id === holdId);
      if (!hold) {
        throw new Error('Authorization hold not found');
      }

      hold.status = 'released';
      hold.releasedAt = new Date().toISOString();
      return hold;
    });
  }

  async createLedgerEntry(entry: {
    propertyId?: string;
    category: string;
    amount: number;
    currency?: string;
    description?: string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.post<LedgerEntry>('/ledger/entries', entry);
      return response.data;
    }, async () => {
      const ledgerEntry: LedgerEntry = {
        id: generateId('ledger'),
        propertyId: entry.propertyId,
        category: entry.category,
        amount: entry.amount,
        currency: entry.currency ?? 'USD',
        description: entry.description,
        referenceId: entry.referenceId,
        metadata: entry.metadata,
        createdAt: new Date().toISOString(),
      };

      this.ledgerEntries.push(ledgerEntry);
      return ledgerEntry;
    });
  }

  async queryLedgerEntries(filters: {
    propertyId?: string;
    category?: string;
    startDate?: string;
    endDate?: string;
  } = {}): Promise<LedgerEntry[]> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.get<LedgerEntry[]>('/ledger/entries', { params: filters });
      return response.data;
    }, async () => {
      return this.ledgerEntries.filter((entry) => {
        if (filters.propertyId && entry.propertyId !== filters.propertyId) return false;
        if (filters.category && entry.category !== filters.category) return false;

        if (filters.startDate) {
          const start = new Date(filters.startDate);
          if (new Date(entry.createdAt) < start) return false;
        }

        if (filters.endDate) {
          const end = new Date(filters.endDate);
          if (new Date(entry.createdAt) > end) return false;
        }

        return true;
      });
    });
  }

  async registerReceptionEvent(event: {
    guestName: string;
    purpose: string;
    contactEmail?: string;
    contactPhone?: string;
    propertyId?: string;
    unitNumber?: string;
    notes?: string;
  }): Promise<ReceptionEvent> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.post<ReceptionEvent>('/reception/events', event);
      return response.data;
    }, async () => {
      const receptionEvent: ReceptionEvent = {
        id: generateId('reception'),
        guestName: event.guestName,
        purpose: event.purpose,
        contactEmail: event.contactEmail,
        contactPhone: event.contactPhone,
        propertyId: event.propertyId,
        unitNumber: event.unitNumber,
        notes: event.notes,
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.receptionQueue.push(receptionEvent);
      return receptionEvent;
    });
  }

  async updateReceptionEventStatus(
    eventId: string,
    status: ReceptionEventStatus,
    notes?: string,
  ): Promise<ReceptionEvent> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.post<ReceptionEvent>(`/reception/events/${eventId}/status`, {
        status,
        notes,
      });
      return response.data;
    }, async () => {
      const event = this.receptionQueue.find((item) => item.id === eventId);
      if (!event) {
        throw new Error('Reception event not found');
      }

      event.status = status;
      event.updatedAt = new Date().toISOString();
      if (notes) {
        event.notes = event.notes ? `${event.notes}\n${notes}` : notes;
      }

      return event;
    });
  }

  async listReceptionEvents(filters: {
    status?: ReceptionEventStatus;
    propertyId?: string;
  } = {}): Promise<ReceptionEvent[]> {
    return this.withOptionalFallback(async () => {
      const response = await this.client!.get<ReceptionEvent[]>('/reception/events', { params: filters });
      return response.data;
    }, async () => {
      return this.receptionQueue.filter((event) => {
        if (filters.status && event.status !== filters.status) return false;
        if (filters.propertyId && event.propertyId !== filters.propertyId) return false;
        return true;
      });
    });
  }

  getTierLimits(): Record<AuthorizationTier, number> {
    return { ...TIER_LIMITS };
  }
}

export const chittyAppsService = new ChittyAppsService();

export async function createAuthorizationHold(params: {
  amount: number;
  currency?: string;
  tenantId?: string;
  propertyId?: string;
  tier?: AuthorizationTier;
  reference?: string;
}): Promise<AuthorizationHold> {
  return chittyAppsService.createAuthorizationHold(params);
}

export async function listAuthorizationHolds(filters?: {
  status?: AuthorizationHold['status'];
  propertyId?: string;
  tier?: AuthorizationTier;
}): Promise<AuthorizationHold[]> {
  return chittyAppsService.listAuthorizationHolds(filters);
}

export async function captureAuthorizationHold(
  holdId: string,
  captureAmount?: number,
): Promise<AuthorizationHold> {
  return chittyAppsService.captureAuthorizationHold(holdId, captureAmount);
}

export async function releaseAuthorizationHold(holdId: string): Promise<AuthorizationHold> {
  return chittyAppsService.releaseAuthorizationHold(holdId);
}

export async function createLedgerEntry(entry: {
  propertyId?: string;
  category: string;
  amount: number;
  currency?: string;
  description?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<LedgerEntry> {
  return chittyAppsService.createLedgerEntry(entry);
}

export async function queryLedgerEntries(filters?: {
  propertyId?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
}): Promise<LedgerEntry[]> {
  return chittyAppsService.queryLedgerEntries(filters);
}

export async function registerReceptionEvent(event: {
  guestName: string;
  purpose: string;
  contactEmail?: string;
  contactPhone?: string;
  propertyId?: string;
  unitNumber?: string;
  notes?: string;
}): Promise<ReceptionEvent> {
  return chittyAppsService.registerReceptionEvent(event);
}

export async function updateReceptionEventStatus(
  eventId: string,
  status: ReceptionEventStatus,
  notes?: string,
): Promise<ReceptionEvent> {
  return chittyAppsService.updateReceptionEventStatus(eventId, status, notes);
}

export async function listReceptionEvents(filters?: {
  status?: ReceptionEventStatus;
  propertyId?: string;
}): Promise<ReceptionEvent[]> {
  return chittyAppsService.listReceptionEvents(filters);
}

export function getTierLimits(): Record<AuthorizationTier, number> {
  return chittyAppsService.getTierLimits();
}

export function getChittyAppsMode(): ChittyAppsMode {
  return chittyAppsService.getMode();
}
