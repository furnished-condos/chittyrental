/**
 * Service clients for cross-service communication.
 * Each returns null if the URL env var is missing (graceful degradation).
 */

interface Env {
  CHITTYGOV_URL?: string;
  CHITTYFINANCE_URL?: string;
  CHITTYCHARGE_URL?: string;
  CHITTYTRANSACT_URL?: string;
  CHITTYSCHEMA_URL?: string;
  CHITTY_AUTH_SERVICE_TOKEN?: string;
}

interface ServiceClient {
  baseUrl: string;
  get: <T = unknown>(path: string) => Promise<T>;
  post: <T = unknown>(path: string, body?: unknown) => Promise<T>;
  put: <T = unknown>(path: string, body?: unknown) => Promise<T>;
}

function makeClient(baseUrl: string, token: string): ServiceClient {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Source-Service": "chittyrental",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`${method} ${baseUrl}${path} returned ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    baseUrl,
    get: <T = unknown>(path: string) => request<T>("GET", path),
    post: <T = unknown>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T = unknown>(path: string, body?: unknown) => request<T>("PUT", path, body),
  };
}

/** ChittyGov API client — entities, authorities, ownership, obligations */
export function govClient(env: Env): ServiceClient | null {
  if (!env.CHITTYGOV_URL) return null;
  return makeClient(env.CHITTYGOV_URL, env.CHITTY_AUTH_SERVICE_TOKEN ?? "");
}

/** ChittyFinance API client — accounts, transactions */
export function financeClient(env: Env): ServiceClient | null {
  if (!env.CHITTYFINANCE_URL) return null;
  return makeClient(env.CHITTYFINANCE_URL, env.CHITTY_AUTH_SERVICE_TOKEN ?? "");
}

/** ChittyCharge API client — holds, captures, releases */
export function chargeClient(env: Env): ServiceClient | null {
  if (!env.CHITTYCHARGE_URL) return null;
  return makeClient(env.CHITTYCHARGE_URL, env.CHITTY_AUTH_SERVICE_TOKEN ?? "");
}

/** ChittySchema API client — canonical schema / mapping registry */
export function schemaClient(env: Env): ServiceClient | null {
  if (!env.CHITTYSCHEMA_URL) return null;
  return makeClient(env.CHITTYSCHEMA_URL, env.CHITTY_AUTH_SERVICE_TOKEN ?? "");
}

/**
 * ChittyTransact API client — unified commerce surface.
 * Wraps ChittyCharge (holds) and the ChittyPay scope (payments, payouts).
 * Prefer this over chargeClient(): transact.chitty.cc/v1/holds/* re-exposes the
 * same hold surface AND adds /v1/payments (charge-now) so rent + deposits go
 * through one service. chargeClient() is retained for backward compatibility.
 */
export function transactClient(env: Env): ServiceClient | null {
  if (!env.CHITTYTRANSACT_URL) return null;
  return makeClient(env.CHITTYTRANSACT_URL, env.CHITTY_AUTH_SERVICE_TOKEN ?? "");
}

export interface RentPaymentResult {
  id: string; // charge_id backlink stored in cr_rent_ledger / cr_payments
  status: string;
  amount: number;
}

/**
 * Charge rent for a lease through ChittyTransact (hold + capture in one call).
 * Returns the payment id to persist as `charge_id`. Falls back to the legacy
 * ChittyCharge two-step only if CHITTYTRANSACT_URL is unset.
 */
export async function chargeRent(
  env: Env,
  input: { amount: number; currency?: string; description: string; lease_id: string; tenant_id?: string },
): Promise<RentPaymentResult> {
  const transact = transactClient(env);
  if (transact) {
    return transact.post<RentPaymentResult>("/v1/payments", {
      amount: input.amount,
      currency: input.currency ?? "usd",
      description: input.description,
      metadata: { lease_id: input.lease_id, ...(input.tenant_id ? { tenant_id: input.tenant_id } : {}), source: "chittyrental" },
    });
  }

  const charge = chargeClient(env);
  if (!charge) throw new Error("Neither CHITTYTRANSACT_URL nor CHITTYCHARGE_URL configured");
  const hold = await charge.post<{ id: string; status: string; amount: number }>("/api/holds", {
    amount: input.amount,
    currency: input.currency ?? "usd",
    description: input.description,
    metadata: { lease_id: input.lease_id, source: "chittyrental" },
  });
  await charge.post(`/api/holds/${hold.id}/capture`, {});
  return { id: hold.id, status: "captured", amount: input.amount };
}
