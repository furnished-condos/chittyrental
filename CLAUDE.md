# CLAUDE.md — ChittyRental

## Project Overview

ChittyRental is the operational property management service for the ChittyOS ecosystem. Cloudflare Worker at `rental.chitty.cc`.

**Repo:** `FURNISHED-CONDOS/chittyrental-v2`
**Stack:** Hono TypeScript, Drizzle ORM, Neon PostgreSQL, Cloudflare Workers (KV)
**Canonical URI:** `chittycanon://core/services/chittyrental` | Tier 5

## Common Commands

```bash
npm run dev          # Start Hono dev server (wrangler dev)
npm run deploy       # Deploy to Cloudflare Workers
npm run typecheck    # TypeScript type check
npm run db:generate  # Generate Drizzle migrations
npm run db:migrate   # Run Drizzle migrations
```

Secrets managed via wrangler (never hardcode):
```bash
wrangler secret put DATABASE_URL
wrangler secret put CHITTY_AUTH_SERVICE_TOKEN
```

## Architecture

Single Cloudflare Worker serving REST API. Frontend TBD (separate Pages project).

### Key Files

- `src/index.ts` — Hono entry point, route mounting, health endpoint, auth middleware
- `src/db/schema.ts` — Drizzle schema for all `cr_*` tables (14 tables)
- `src/lib/db.ts` — Neon connection helper
- `src/lib/clients.ts` — Service clients for ChittyGov, ChittyFinance, ChittyCharge
- `src/routes/` — Route handlers (portfolios, properties, units, tenants, leases, agreements, maintenance, vrf, rent, wizard)

### Database

Neon PostgreSQL. All tables prefixed `cr_`. UUID primary keys. Cross-service references are TEXT columns:
- `gov_entity_id` / `gov_asset_id` — ChittyGov references
- `cf_property_id` / `cf_transaction_id` — ChittyFinance references
- `charge_id` — ChittyCharge references

### Cross-Service Integration

- **ChittyGov** (`gov.chitty.cc`) — Entity/asset governance, ownership
- **ChittyFinance** (`finance.chitty.cc`) — Accounts, transactions, reconciliation
- **ChittyCharge** (`charge.chitty.cc`) — Payment holds, captures, releases
- **ChittyConnect** (`connect.chitty.cc`) — Service discovery

All clients use `Authorization: Bearer {CHITTY_AUTH_SERVICE_TOKEN}` + `X-Source-Service: chittyrental`.

## Security

- Secrets via `wrangler secret put` — never in `[vars]`
- Auth middleware checks Bearer token against `CHITTY_AUTH_SERVICE_TOKEN`
- Dev mode (`ENVIRONMENT != 'production'`) bypasses auth
- CORS restricted to `rental.chitty.cc`, `app.rental.chitty.cc`, `localhost:5173`
