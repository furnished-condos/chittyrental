/**
 * Google service account JWT signing + access token exchange.
 *
 * Runs in Cloudflare Workers using Web Crypto (RS256). The same service
 * account GAM uses (domain-wide delegation on `chitty.cc`) is consumed
 * here to call Sheets / Calendar / Drive / Tasks / Chat APIs directly.
 *
 * Secrets:
 *   GOOGLE_SA_KEY      — base64-encoded service account JSON
 *   GOOGLE_SA_SUBJECT  — admin user to impersonate, e.g. gam@chitty.cc
 */

export interface ServiceAccountKey {
  client_email: string;
  private_key: string; // PEM PKCS#8
  token_uri: string;
}

export interface TokenCache {
  token: string;
  expiresAt: number; // epoch seconds
}

const tokenMemo = new Map<string, TokenCache>();

export function parseServiceAccountKey(b64: string): ServiceAccountKey {
  const json = atob(b64);
  const parsed = JSON.parse(json) as Partial<ServiceAccountKey>;
  if (!parsed.client_email || !parsed.private_key || !parsed.token_uri) {
    throw new Error("GOOGLE_SA_KEY missing required fields");
  }
  return parsed as ServiceAccountKey;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array | string): string {
  let b64: string;
  if (typeof bytes === "string") {
    b64 = btoa(bytes);
  } else {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let bin = "";
    for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
    b64 = btoa(bin);
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function signJwt(
  sa: ServiceAccountKey,
  scopes: string[],
  subject?: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };
  if (subject) payload.sub = subject;

  const encoded = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(payload)
  )}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(encoded)
  );
  return `${encoded}.${base64UrlEncode(sig)}`;
}

export async function getAccessToken(
  env: { GOOGLE_SA_KEY: string; GOOGLE_SA_SUBJECT?: string },
  scopes: string[],
  subject?: string
): Promise<string> {
  const impersonate = subject ?? env.GOOGLE_SA_SUBJECT;
  const cacheKey = `${impersonate ?? "-"}|${scopes.join(",")}`;
  const cached = tokenMemo.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached.token;

  const sa = parseServiceAccountKey(env.GOOGLE_SA_KEY);
  const jwt = await signJwt(sa, scopes, impersonate);
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenMemo.set(cacheKey, {
    token: body.access_token,
    expiresAt: now + body.expires_in,
  });
  return body.access_token;
}

/** Convenience scope constants. */
export const SCOPES = {
  SHEETS_RO: "https://www.googleapis.com/auth/spreadsheets.readonly",
  SHEETS_RW: "https://www.googleapis.com/auth/spreadsheets",
  CALENDAR: "https://www.googleapis.com/auth/calendar",
  DRIVE: "https://www.googleapis.com/auth/drive",
  TASKS: "https://www.googleapis.com/auth/tasks",
  CHAT_SPACES: "https://www.googleapis.com/auth/chat.spaces",
  CHAT_MESSAGES: "https://www.googleapis.com/auth/chat.messages",
  CHAT_MEMBERSHIPS: "https://www.googleapis.com/auth/chat.memberships",
  ADMIN_RES_CAL: "https://www.googleapis.com/auth/admin.directory.resource.calendar",
  ADMIN_ORGUNIT: "https://www.googleapis.com/auth/admin.directory.orgunit",
  ADMIN_GROUP: "https://www.googleapis.com/auth/admin.directory.group",
  ADMIN_GROUP_MEMBER: "https://www.googleapis.com/auth/admin.directory.group.member",
} as const;
