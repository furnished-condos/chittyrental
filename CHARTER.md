# CHARTER.md — ChittyRental

> Canonical URI: `chittycanon://core/services/chittyrental`
> Tier: 5 (Application)
> Domain: `rental.chitty.cc`
> Repo: `FURNISHED-CONDOS/chittyrental-v2`

## Purpose

ChittyRental is the operational property management layer for the ChittyOS ecosystem. It replaces the legacy `furnished-condos/rental-manager` Express app and sits between ChittyGov (governance/entity source of truth) and ChittyFinance (financial source of truth).

## Scope

- Portfolio and property CRUD with multi-platform listing sync
- Unit, tenant, and lease lifecycle management
- Agreement/rule engine (fee models, VRF config, RLTO jurisdictional rules)
- Virtual Reserve Fund (VRF) ledger per property
- Rent ledger with ChittyFinance/ChittyCharge backlinks
- Maintenance work order tracking
- Asset and inspection management
- AI-guided property setup wizard
- Cross-service sync logging

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| CRUD | `/api/portfolios` | Portfolio management |
| CRUD | `/api/properties` | Property management + platform sync |
| CRUD | `/api/units` | Unit management |
| CRUD | `/api/tenants` | Tenant lifecycle |
| CRUD | `/api/leases` | Lease lifecycle |
| CRUD | `/api/agreements` | Fee model / rule configuration |
| CRUD | `/api/maintenance` | Work order management |
| GET | `/api/vrf` | VRF ledger queries |
| GET/POST | `/api/rent` | Rent ledger, payment recording |
| POST | `/api/wizard/*` | AI setup wizard |

## Dependencies (Upstream)

| Service | Purpose | Reference Column |
|---------|---------|-----------------|
| ChittyGov | Entity/asset governance SoT | `gov_entity_id`, `gov_asset_id` |
| ChittyFinance | Financial SoT, transaction backlinks | `cf_property_id`, `cf_transaction_id` |
| ChittyCharge | Payment holds/captures | `charge_id` |
| ChittyConnect | Service discovery | env `CHITTYCONNECT_URL` |
| ChittyAuth | Token validation | `CHITTY_AUTH_SERVICE_TOKEN` |

## Dependencies (Downstream)

| Consumer | Purpose |
|----------|---------|
| ChittyCommand | Obligation/payment dashboard integration |
| ChittyFinance | Rent payment reconciliation callbacks |

## Data Ownership

All `cr_*` tables in Neon PostgreSQL. Cross-service references stored as TEXT columns (never foreign keys to external DBs).

## Auth

- Bearer token validation against `CHITTY_AUTH_SERVICE_TOKEN`
- Dev mode bypasses auth when `ENVIRONMENT != 'production'`
