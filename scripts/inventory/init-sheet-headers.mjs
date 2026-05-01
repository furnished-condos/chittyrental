#!/usr/bin/env node
/**
 * One-shot: write the canonical inventory header row to the configured
 * Google Sheet. Idempotent — safe to re-run; sets row 1 of the "Global"
 * tab to the target schema regardless of current contents.
 *
 * Usage:
 *   GOOGLE_SA_KEY="$(cat sa.json | base64 -w0)" \
 *   GOOGLE_SA_SUBJECT="gam@chitty.cc" \
 *   INVENTORY_SHEET_ID="1Zsu...nyWI" \
 *   node scripts/inventory/init-sheet-headers.mjs
 *
 * Or with --dry-run to print the planned write without sending it:
 *   node scripts/inventory/init-sheet-headers.mjs --dry-run
 *
 * The set of headers below MUST match the keys (in insertion order) of
 * INVENTORY_MASTER_MAPPING.headers in src/lib/inventory-mapping.ts so
 * the read side recognizes every column.
 *
 * Service account scopes required:
 *   https://www.googleapis.com/auth/spreadsheets
 */

import crypto from "node:crypto";

const TAB = "Global";
const HEADERS = [
  // Starting-place columns the draft sheet has today (kept in current order)
  "Location",
  "Item Category",
  "Item Description",
  "Quantity",
  "Condition",
  "Brand/Model (Optional)",
  // Aspirational columns — operators fill these in over time
  "Asset Type",
  "Serial",
  "Vendor",
  "Purchase Date",
  "Purchase Price",
  "Warranty Until",
  "Status",
  "Location Notes",
  "Receipt URL",
  "Replacement Cost",
  "Life Years",
  "Last Service",
  "Service Interval (days)",
];

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function colLetter(n) {
  // 1-indexed: 1 → A, 26 → Z, 27 → AA …
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function decodeSaKey() {
  const raw = process.env.GOOGLE_SA_KEY;
  if (!raw) fail("GOOGLE_SA_KEY not set (base64-encoded service account JSON)");
  let json;
  try {
    json = Buffer.from(raw, "base64").toString("utf8");
  } catch (e) {
    fail(`GOOGLE_SA_KEY: failed to base64-decode: ${e.message}`);
  }
  let sa;
  try {
    sa = JSON.parse(json);
  } catch (e) {
    fail(`GOOGLE_SA_KEY: not valid JSON: ${e.message}`);
  }
  if (!sa.client_email || !sa.private_key || !sa.token_uri) {
    fail("GOOGLE_SA_KEY missing client_email / private_key / token_uri");
  }
  return sa;
}

function b64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt(sa, scopes, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
    ...(subject ? { sub: subject } : {}),
  };
  const encoded =
    `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(encoded);
  signer.end();
  const sig = signer.sign(sa.private_key);
  return `${encoded}.${b64url(sig)}`;
}

async function getAccessToken(sa, scopes, subject) {
  const jwt = signJwt(sa, scopes, subject);
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    fail(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()).access_token;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sheetId = process.env.INVENTORY_SHEET_ID;
  if (!sheetId) fail("INVENTORY_SHEET_ID not set");
  const subject = process.env.GOOGLE_SA_SUBJECT;

  const sa = decodeSaKey();
  const lastCol = colLetter(HEADERS.length);
  const range = `${TAB}!A1:${lastCol}1`;

  console.log(`target: spreadsheet=${sheetId} range=${range}`);
  console.log(`headers (${HEADERS.length}): ${HEADERS.join(" | ")}`);

  // Note: dry-run still performs the auth + GET so operators can see
  // exactly which existing cells would be overwritten. Only the final
  // PUT is skipped.
  const token = await getAccessToken(
    sa,
    ["https://www.googleapis.com/auth/spreadsheets"],
    subject
  );

  // First, fetch existing row 1 so we can warn if any cells will be overwritten.
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`;
  const getRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (getRes.ok) {
    const body = await getRes.json();
    const existing = (body.values && body.values[0]) || [];
    const overwrites = HEADERS
      .map((h, i) => ({ i, want: h, have: existing[i] ?? "" }))
      .filter((c) => c.have && c.have !== c.want);
    if (overwrites.length) {
      console.warn("warning: the following cells will be overwritten:");
      for (const o of overwrites) {
        console.warn(`  ${colLetter(o.i + 1)}1: "${o.have}" → "${o.want}"`);
      }
    }
  } else {
    console.warn(`could not read existing row 1 (${getRes.status}); proceeding with write`);
  }

  if (dryRun) {
    console.log("DRY: skipping write");
    return;
  }

  const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const putRes = await fetch(putUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ range, majorDimension: "ROWS", values: [HEADERS] }),
  });
  if (!putRes.ok) {
    fail(`sheets values.update failed: ${putRes.status} ${(await putRes.text()).slice(0, 300)}`);
  }
  const result = await putRes.json();
  console.log(
    `ok: updated ${result.updatedCells ?? "?"} cells (${result.updatedRange ?? range})`
  );
}

main().catch((err) => fail(String(err)));
