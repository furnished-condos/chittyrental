# CHITTY.md — ChittyRental

| Field | Value |
|-------|-------|
| **Service** | ChittyRental |
| **Canonical URI** | `chittycanon://core/services/chittyrental` |
| **Tier** | 5 (Application) |
| **Domain** | `rental.chitty.cc` |
| **Stack** | Hono + Drizzle + Neon PostgreSQL + Cloudflare Workers |
| **Repo** | `FURNISHED-CONDOS/chittyrental-v2` |
| **Replaces** | `furnished-condos/rental-manager` (legacy Express) |
| **Status** | Scaffolded |
| **Certification** | Pending |

## Position in Ecosystem

```
ChittyGov (governance SoT)
    |
ChittyRental (operational property management)  <-- this service
    |
ChittyFinance (financial SoT) + ChittyCharge (payments)
    |
ChittyCommand (action dashboard)
```

## Tables

14 tables, all `cr_*` prefixed: portfolios, properties, units, tenants, leases, agreements, vrf_ledger, rent_ledger, maintenance, assets, inspections, listings, setup_sessions, sync_log.
