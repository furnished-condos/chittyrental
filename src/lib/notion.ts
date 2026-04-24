/**
 * Notion gateway client.
 *
 * Points at NOTION_GATEWAY_URL (defaults to https://mcp.ch1tty.com) with
 * NOTION_GATEWAY_TOKEN. The gateway is expected to mirror Notion's own API
 * shape for databases (or a compatible subset). If you point it directly
 * at https://api.notion.com instead, set NOTION_GATEWAY_TOKEN to a
 * Notion integration secret and the client works as-is.
 */

import {
  NOTION_PORTFOLIO_MAP,
  NOTION_PROPERTY_MAP,
  NOTION_UNIT_MAP,
  mappingsConfigured,
} from "./notion-mapping";

export interface NotionEnv {
  NOTION_GATEWAY_URL?: string;
  NOTION_GATEWAY_TOKEN?: string;
  NOTION_DATABASE_ID?: string;
  NOTION_UNITS_DATABASE_ID?: string;
  NOTION_PORTFOLIOS_DATABASE_ID?: string;
}

export interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
  url?: string;
  last_edited_time?: string;
}

export interface NotionQueryResponse {
  results: NotionPage[];
  next_cursor: string | null;
  has_more: boolean;
}

function defaultGateway(env: NotionEnv): string {
  return env.NOTION_GATEWAY_URL ?? "https://mcp.ch1tty.com";
}

async function queryDatabase(
  env: NotionEnv,
  databaseId: string,
  cursor?: string
): Promise<NotionQueryResponse> {
  const res = await fetch(`${defaultGateway(env)}/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Source-Service": "chittyrental",
      ...(env.NOTION_GATEWAY_TOKEN
        ? { Authorization: `Bearer ${env.NOTION_GATEWAY_TOKEN}` }
        : {}),
      // Also support direct Notion API if gateway points at api.notion.com
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
  });
  if (!res.ok) {
    throw new Error(`notion query failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<NotionQueryResponse>;
}

export async function fetchAll(
  env: NotionEnv,
  databaseId: string
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const chunk = await queryDatabase(env, databaseId, cursor);
    pages.push(...chunk.results);
    cursor = chunk.has_more ? chunk.next_cursor ?? undefined : undefined;
  } while (cursor);
  return pages;
}

/**
 * Extract a simple scalar value from a Notion property payload.
 * Handles title, rich_text, number, select, multi_select, date, relation.
 */
export function extractValue(prop: unknown): unknown {
  if (!prop || typeof prop !== "object") return null;
  const p = prop as { type?: string } & Record<string, unknown>;
  switch (p.type) {
    case "title": {
      const arr = p.title as Array<{ plain_text?: string }> | undefined;
      return arr?.map((t) => t.plain_text ?? "").join("") ?? null;
    }
    case "rich_text": {
      const arr = p.rich_text as Array<{ plain_text?: string }> | undefined;
      return arr?.map((t) => t.plain_text ?? "").join("") ?? null;
    }
    case "number":
      return (p.number as number | null) ?? null;
    case "select": {
      const s = p.select as { name?: string } | null;
      return s?.name ?? null;
    }
    case "multi_select": {
      const arr = p.multi_select as Array<{ name?: string }> | undefined;
      return arr?.map((t) => t.name ?? "").filter(Boolean) ?? [];
    }
    case "date": {
      const d = p.date as { start?: string } | null;
      return d?.start ?? null;
    }
    case "relation": {
      const arr = p.relation as Array<{ id?: string }> | undefined;
      return arr?.map((r) => r.id).filter(Boolean) ?? [];
    }
    case "url":
      return (p.url as string | null) ?? null;
    case "email":
      return (p.email as string | null) ?? null;
    case "phone_number":
      return (p.phone_number as string | null) ?? null;
    case "checkbox":
      return (p.checkbox as boolean | null) ?? null;
    case "files": {
      const arr = p.files as Array<{ file?: { url?: string }; external?: { url?: string } }> | undefined;
      return arr?.map((f) => f.file?.url ?? f.external?.url).filter(Boolean) ?? [];
    }
    default:
      return null;
  }
}

/** Project a Notion page to a flat record using a field map. */
export function project(
  page: NotionPage,
  map: Record<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = { _notion_id: page.id };
  for (const [crField, notionKey] of Object.entries(map)) {
    // Support both id (%3A…) and property name lookups.
    const prop =
      page.properties[notionKey] ??
      // fallback: case-insensitive name scan
      Object.entries(page.properties).find(
        ([k]) => k.toLowerCase() === notionKey.toLowerCase()
      )?.[1];
    out[crField] = extractValue(prop);
  }
  return out;
}

export async function fetchProperties(env: NotionEnv): Promise<Record<string, unknown>[]> {
  if (!env.NOTION_DATABASE_ID) throw new Error("NOTION_DATABASE_ID not set");
  const pages = await fetchAll(env, env.NOTION_DATABASE_ID);
  return pages.map((p) => project(p, NOTION_PROPERTY_MAP));
}

export async function fetchUnits(env: NotionEnv): Promise<Record<string, unknown>[]> {
  // Units may live in a separate DB, or inline as sub-items; default to a
  // separate DB if NOTION_UNITS_DATABASE_ID is set, else return [].
  if (!env.NOTION_UNITS_DATABASE_ID) return [];
  const pages = await fetchAll(env, env.NOTION_UNITS_DATABASE_ID);
  return pages.map((p) => project(p, NOTION_UNIT_MAP));
}

export async function fetchPortfolios(env: NotionEnv): Promise<Record<string, unknown>[]> {
  if (!env.NOTION_PORTFOLIOS_DATABASE_ID) return [];
  const pages = await fetchAll(env, env.NOTION_PORTFOLIOS_DATABASE_ID);
  return pages.map((p) => project(p, NOTION_PORTFOLIO_MAP));
}

export function configStatus(env: NotionEnv): {
  gateway: string;
  has_token: boolean;
  has_database_id: boolean;
  mappings_configured: boolean;
} {
  return {
    gateway: defaultGateway(env),
    has_token: Boolean(env.NOTION_GATEWAY_TOKEN),
    has_database_id: Boolean(env.NOTION_DATABASE_ID),
    mappings_configured: mappingsConfigured(),
  };
}
