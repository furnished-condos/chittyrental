# Inventory Management Lifecycle — ChittyRental

Companion to [`gam-resources-strategy.md`](./gam-resources-strategy.md).
Defines how rental-unit inventory (appliances, furniture, smart home,
consumables) is planned in the Google Sheet, recorded in `cr_assets`, and
surfaced through calendar events, tasks, and the property Shared Drive.

## Scope

"Inventory" here covers anything trackable that sits in or belongs to a
unit/property:

- **Fixed assets** — appliances, furniture, HVAC, water heaters, locks,
  cameras, smart home gear.
- **Consumables** — linens, toiletries, kitchen basics, cleaning supplies
  (for furnished / short-term rentals).
- **Tools & spares** — property tools, keys, remotes, filters.

Not in scope: tenant belongings, owner personal items.

## Truth model

```
Google Sheet (planning/bulk edit)
  1Zsu533Uy498ekbXdWpMuw8xIPAl5MCjf7mxFYkznyWI
              │
              ▼   (Worker pull, /api/gam/inventory/sync)
       cr_assets  (system of record)
              │
              ├─► Calendar events (maintenance reminders, warranty)
              ├─► Google Tasks (reorder, warranty review)
              ├─► Drive: Inventory-Receipts/ (purchase docs, photos)
              ├─► Chat: #{property} cards on state change
              └─► cr_financial_reports (weekly optimization report)
```

The sheet is the planning surface. DB is canonical. Sheet writes back only
through a controlled reconcile (flagged cells the operator can resolve).

## Lifecycle states

Stored in `cr_assets.status` (extended values — no schema change):

| State | Meaning | Typical next state |
|---|---|---|
| `planned` | In budget, not ordered | `ordered`, `cancelled` |
| `ordered` | PO out / cart placed | `received` |
| `received` | At property, not yet deployed | `deployed` |
| `deployed` / `active` | In use | `repair`, `end_of_life`, `missing` |
| `repair` | Out for service | `active`, `retired` |
| `missing` | Can't locate at inspection | `active` (found), `written_off` |
| `end_of_life` | Decision pending on replacement | `retired`, `sold` |
| `retired` | Out of service, disposed | (terminal) |
| `sold` | Sold, proceeds logged | (terminal) |
| `written_off` | Loss recorded | (terminal) |

State changes write a row to `cr_sync_log` (sync_type `inventory_state`,
metadata with prev/next).

## Sheet schema (TBD — placeholders)

> **Action required:** confirm real tabs and columns against the live
> sheet. Fill the placeholders in `src/lib/inventory-mapping.ts`.

Assumed tabs:

| Tab | Purpose |
|---|---|
| `Master` | One row per asset across all properties |
| `Consumables` | Reorder-tracked items per property |
| `Templates` | Per-property-type default kit (studio, 1BR, 2BR, SFH) |
| `Vendors` | Preferred vendor directory |
| `Warranties` | Extended warranty tracking |

### `Master` tab — assumed columns

| Col | Header (assumed) | Maps to `cr_assets` |
|---|---|---|
| A | Asset ID | `external_id` (generated if blank) |
| B | Property | `property_id` (lookup by name/slug) |
| C | Unit | `unit_id` (optional) |
| D | Name | `name` |
| E | Category | `asset_type` |
| F | Model | `model` |
| G | Serial | `serial_number` |
| H | Vendor | `vendor` |
| I | Purchase date | `purchase_date` |
| J | Purchase price | `purchase_price` |
| K | Warranty until | `warranty_expiration` |
| L | Status | `status` (mapped to lifecycle above) |
| M | Location notes | `metadata.location_notes` |
| N | Receipt link | `metadata.receipt_url` |
| O | Replacement cost (est.) | `metadata.replacement_cost` |
| P | Expected life (yrs) | `metadata.life_years` |
| Q | Last service | `metadata.last_service_date` |
| R | Service interval (days) | `metadata.service_interval_days` |

### `Consumables` tab — assumed columns

| Col | Header (assumed) | Notes |
|---|---|---|
| A | Property | `property_id` |
| B | Item | `name` |
| C | Current qty | triggers reorder when < `reorder_threshold` |
| D | Reorder threshold | `metadata.reorder_threshold` |
| E | Supplier | `vendor` |
| F | Last restocked | `metadata.last_restocked` |
| G | Unit price | `metadata.unit_price` |

Consumables become `cr_assets` rows with `asset_type = 'consumable'` and
`status = 'active'`.

## Reconciliation logic

### Pull (sheet → DB), `/api/gam/inventory/sync`

1. Auth as service account → pull `Master`, `Consumables`, `Templates`
   tabs via `spreadsheets.values.batchGet`.
2. Validate headers against `src/lib/inventory-mapping.ts` — fail fast
   if a mapped column is missing.
3. For each row:
   - Resolve `property_id` (by slug or name).
   - Resolve `unit_id` (by `unit_number` within property).
   - Compute `external_id` if blank = `sha256(property_slug + unit +
     name + serial).slice(0, 8)`.
   - UPSERT into `cr_assets` keyed on `(external_id)`.
4. For rows in DB but not in sheet (lifecycle `active`) → mark
   `metadata.sheet_orphan = true` and surface in the reconcile report
   (do **not** auto-delete).
5. Write `cr_sync_log` with counts + any validation errors.

### Push (DB → sheet)

Only status-column writeback, via `spreadsheets.values.update` on column
`L`. Runs after calendar state changes. Cells flipped by the Worker get a
developer metadata tag so operators know it was auto-set.

## Calendar integration

### Preventive maintenance reminders

For each asset with `metadata.service_interval_days`, a weekly cron
generates (or verifies) a recurring calendar event on the unit's
calendar:

- `summary` = `🔧 {asset.name} service`
- `description` = link back to `cr_assets.id`
- `recurrence` = `RRULE:FREQ=DAILY;INTERVAL={interval_days}`
- `extendedProperties.private.chitty.type` = `maintenance:reminder`
- `extendedProperties.private.chitty.asset_id` = asset id

### Warranty expiration

Per asset with `warranty_expiration`: single event 30 days prior,
attendees = owner group + manager group. On event accept/decline the
owner's decision is recorded to `metadata.warranty_decision`.

### End-of-life signal

When total repair cost in the trailing 12 months exceeds 50% of
`metadata.replacement_cost`, the asset is flagged `end_of_life` and a
decision task is created in Tasks.

## Tasks integration

| Signal | Task |
|---|---|
| Consumable qty < reorder threshold | "Reorder {item} for {property}" assigned to manager |
| Warranty < 30 days | "Decide renew/replace: {asset}" assigned to owner |
| Asset in `repair` > 14 days | "Repair stuck — escalate: {asset}" to manager |
| Inspection finds asset missing | "Locate / write-off: {asset}" to manager |

## Drive integration

- Receipts dropped into
  `Inventory-Receipts/{YYYY-MM}/` (manual upload or email forwarded to
  `inventory@chitty.cc`).
- Apps Script watcher picks up new files → `POST /api/gam/inventory-receipt`
  with file ID + property inference from filename.
- Worker calls Gemini to extract `{ vendor, amount, item, serial, date }`
  → matches to existing asset or creates a new one in `planned` status.

## Optimization report

Weekly cron `POST /api/gam/inventory/optimize` generates a
`cr_financial_reports` row per property:

- Assets due for service in next 30 days.
- Assets approaching end-of-life (trailing repair cost / replacement cost).
- Depreciation schedule (straight-line).
- Reorder list with suggested PO.
- Vendor performance summary (avg days in `repair` per vendor).
- `ai_insights`: Gemini narrative recommending top 3 actions.

Report posted as a card into `#{property}` Chat space and filed in
`Accounting/{YYYY}/inventory-optimization-{YYYY-MM-DD}.pdf`.

## Access & permissions

- Operators edit the sheet directly (sheet ACL = ops group).
- Owners view a filtered sheet (one tab per property, via `IMPORTRANGE`
  into their owner-only workbook) — no Worker involvement.
- `cr_assets` PII-safe — no tenant data lives here.

## Open items

- Confirm real tab + column IDs (see TBDs above).
- Decide on a "soft-delete via sheet" convention (e.g. row highlighted red
  → DB marks `retired`).
- Consumable thresholds default: per template or per property override?
