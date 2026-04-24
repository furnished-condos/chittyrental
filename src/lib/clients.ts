/**
 * Service clients for cross-service communication.
 * Each returns null if the URL env var is missing (graceful degradation).
 */

interface Env {
  CHITTYGOV_URL?: string;
  CHITTYFINANCE_URL?: string;
  CHITTYCHARGE_URL?: string;
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
