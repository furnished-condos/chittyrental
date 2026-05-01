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

## Sheet schema

The inventory sheet starts as a simple roster ("starting place") and grows
into the full schedule below as operators add columns. Mapping is by
**header name** rather than column letter, so adding a column to the
sheet automatically lights it up in the sync — no code change required.

The canonical tab is `Global` (one row per asset across all properties).
Per-property tabs (e.g. `Lakeside Loft`) are presumed to be filtered
views of the same data and are not read separately.

### Starting place — columns currently in the draft sheet

| Header | cr_assets target | Notes |
|---|---|---|
| `Location` | `_refs.location` → `property_id` | property name; resolved at sync |
| `Item Category` | `metadata.room` | Bedroom / Kitchen / Living Room / All Rooms / … |
| `Item Description` | `name` | the human-readable asset name |
| `Quantity` | `metadata.quantity` | number; blank or `~` → null |
| `Condition` | `metadata.condition` | New / Excellent / Good / Like New |
| `Brand/Model (Optional)` | `model` | raw vendor/model description |

When the sheet has only these six columns, `cr_assets.asset_type` is
**derived** from `Item Description` keywords (`deriveAssetType()` in
`src/lib/inventory-mapping.ts`); `cr_assets.status` defaults to `active`.

### Target schema — operators add over time

| Header | cr_assets target | Notes |
|---|---|---|
| `Asset Type` | `asset_type` | overrides keyword derivation when present |
| `Serial` | `serial_number` | |
| `Vendor` | `vendor` | |
| `Purchase Date` | `purchase_date` | YYYY-MM-DD; required for depreciation |
| `Purchase Price` | `purchase_price` | decimal; required for depreciation |
| `Warranty Until` | `warranty_expiration` | YYYY-MM-DD |
| `Status` | `status` | mapped via STATUS_MAP (planned/active/repair/...) |
| `Location Notes` | `metadata.location_notes` | |
| `Receipt URL` | `metadata.receipt_url` | |
| `Replacement Cost` | `metadata.replacement_cost` | |
| `Life Years` | `metadata.life_years` | overrides DEFAULT_LIFE_YEARS |
| `Last Service` | `metadata.last_service_date` | |
| `Service Interval (days)` | `metadata.service_interval_days` | |

### Updating the sheet

To set the canonical header row on the live sheet (writes row 1 of the
`Global` tab to the union of all headers above):

```bash
GOOGLE_SA_KEY="$(base64 -w0 < sa.json)" \
GOOGLE_SA_SUBJECT="gam@chitty.cc" \
INVENTORY_SHEET_ID="1Zsu...nyWI" \
node scripts/inventory/init-sheet-headers.mjs
# add --dry-run to preview without writing
```

The script is idempotent — re-runs reset the header row to the
canonical names. Existing data rows are untouched.

### Consumables (deferred)

A separate consumables tab isn't present in the current sheet. When one
is added, support can be reinstated by adding a second mapping in
`src/lib/inventory-mapping.ts` with its own `headers` set; the
`pullByMapping` helper in `src/lib/inventory.ts` is generic.

## Reconciliation logic

### Pull (sheet → DB), `/api/gam/inventory/sync`

1. Auth as service account and read the configured `Global!A1:Z` range
   via `spreadsheets.values.get` (single tab — `Master` / `Consumables`
   / `Templates` are no longer read).
2. Build a header index from row 1. Mapped headers that aren't present
   produce `null` cells per row — the sync **does not** fail-fast on
   missing columns, so the same code handles the starting-place sheet
   and the full target schema.
3. For each non-blank data row:
   - Resolve `property_id` from the `Location` cell (by name).
   - Resolve `unit_id` if a `Unit` column is added later (today: null).
   - Compute `external_id` if blank = `sha256(property_slug + unit +
     name + serial).slice(0, 8)`.
   - UPSERT into `cr_assets` keyed on `(external_id)`.
4. For rows in DB but not in sheet (lifecycle `active`) → mark
   `metadata.sheet_orphan = true` and surface in the reconcile report
   (do **not** auto-delete).
5. Write `cr_sync_log` with counts + any validation errors.

### Push (DB → sheet)

Only status-column writeback, via `spreadsheets.values.update` on the
`Status` header column (column `M` under the canonical header order
emitted by `scripts/inventory/init-sheet-headers.mjs`; if operators
reorder columns, the writer resolves the live position by reading row 1
first). Runs after calendar state changes. Cells flipped by the Worker
get a developer-metadata tag so operators know it was auto-set.

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
