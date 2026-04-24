/**
 * ChittySchema integration — canonical schema / mapping registry.
 *
 * ChittySchema at `schema.chitty.cc` hosts the authoritative definitions for
 * cross-service shapes (Notion property IDs, inventory sheet columns,
 * channel catalogs, the event taxonomy carried on calendar
 * extendedProperties, and the `chittycanon://` URIs that identify them).
 *
 * This module is a thin, optional cache layer: if `CHITTYSCHEMA_URL` is not
 * configured the Worker falls back to the hardcoded mappings in
 * `notion-mapping.ts` / `inventory-mapping.ts`. When it is configured, we
 * pull the canonical maps at startup (cached in KV) and the local files
 * become defaults only.
 */

import { schemaClient } from "./clients";

export const CHITTY_CANON = {
  service: "chittycanon://core/services/chittyrental",
  notionMap: "chittycanon://core/schemas/chittyrental/notion-property-map",
  unitMap: "chittycanon://core/schemas/chittyrental/notion-unit-map",
  portfolioMap: "chittycanon://core/schemas/chittyrental/notion-portfolio-map",
  inventoryMaster: "chittycanon://core/schemas/chittyrental/inventory-master-map",
  inventoryConsumables: "chittycanon://core/schemas/chittyrental/inventory-consumables-map",
  channelCatalog: "chittycanon://core/schemas/chittyrental/channel-catalog",
  eventTaxonomy: "chittycanon://core/schemas/chittyrental/event-taxonomy",
} as const;

export interface SchemaEnv {
  CHITTYSCHEMA_URL?: string;
  CHITTY_AUTH_SERVICE_TOKEN?: string;
  RENTAL_CACHE?: KVNamespace;
}

export interface SchemaDefinition<T = unknown> {
  canon: string;
  version: string;
  etag?: string;
  payload: T;
}

const KV_TTL_SECONDS = 5 * 60;

function kvKey(canon: string): string {
  return `chittyschema:${canon}`;
}

/**
 * Fetch a canonical schema definition by `chittycanon://` URI. Returns null
 * if ChittySchema is not configured or is unreachable — callers must fall
 * back to hardcoded defaults in that case.
 */
export async function fetchSchema<T = unknown>(
  env: SchemaEnv,
  canon: string
): Promise<SchemaDefinition<T> | null> {
  // KV cache first
  if (env.RENTAL_CACHE) {
    const cached = await env.RENTAL_CACHE.get(kvKey(canon), "json");
    if (cached) return cached as SchemaDefinition<T>;
  }

  const client = schemaClient({
    CHITTYSCHEMA_URL: env.CHITTYSCHEMA_URL,
    CHITTY_AUTH_SERVICE_TOKEN: env.CHITTY_AUTH_SERVICE_TOKEN,
  });
  if (!client) return null;

  try {
    const body = await client.get<SchemaDefinition<T>>(
      `/v1/schemas/${encodeURIComponent(canon)}`
    );
    if (env.RENTAL_CACHE) {
      await env.RENTAL_CACHE.put(kvKey(canon), JSON.stringify(body), {
        expirationTtl: KV_TTL_SECONDS,
      });
    }
    return body;
  } catch {
    // Fail closed: callers must fall back gracefully.
    return null;
  }
}

/** Publish a canonical snapshot to ChittySchema (used by admin endpoints). */
export async function publishSchema(
  env: SchemaEnv,
  canon: string,
  version: string,
  payload: unknown
): Promise<boolean> {
  const client = schemaClient({
    CHITTYSCHEMA_URL: env.CHITTYSCHEMA_URL,
    CHITTY_AUTH_SERVICE_TOKEN: env.CHITTY_AUTH_SERVICE_TOKEN,
  });
  if (!client) return false;
  try {
    await client.post(`/v1/schemas/${encodeURIComponent(canon)}`, {
      version,
      payload,
    });
    if (env.RENTAL_CACHE) {
      await env.RENTAL_CACHE.delete(kvKey(canon));
    }
    return true;
  } catch {
    return false;
  }
}
