# GAM Schema Mapping — Notion / Sheet / cr_* / Workspace

Companion to [`gam-resources-strategy.md`](./gam-resources-strategy.md).
Column-level mapping across the four data planes:

1. **Notion DB** (`cb6da6660e854792abcb81157920600b`) — planning surface
2. **Google Sheet** (`1Zsu533Uy498ekbXdWpMuw8xIPAl5MCjf7mxFYkznyWI`) —
   inventory planning surface
3. **cr_*** Neon tables — system of record
4. **Google Workspace** (OU / Group / Calendar Resource / Drive / Tasks)
   — execution surface

> **Placeholders.** Notion property names below are assumed. Fill the real
> property IDs in `src/lib/notion-mapping.ts` after inspecting the DB.

## Legend

- `⟶` flow direction (authoritative side → dependent side)
- `†` derived (not stored directly — computed at sync time)
- `§` manually reviewed (not auto-synced)

## 1. Portfolio

| Notion (`Portfolios` view or `Portfolio` select) | `cr_portfolios` | Workspace artifact |
|---|---|---|
| `Name` (title) | `name` | OU: `/ChittyRental/{slug(name)}` |
| `Entity` (ChittyGov ref) | `gov_entity_id` | — |
| `Description` | `description` | — |
| `Status` (select) | `status` | Group status (`suspended` if portfolio inactive) |
| — | `id` (uuid, pk) | `ou.externalId = cr_portfolios.id` (informational) |
| — | derived † | Groups: `{slug}-owners`, `{slug}-managers`, `{slug}-vendors` |

**Flow:** Notion ⟶ `cr_portfolios` ⟶ GAM (via desired-state CSV).

## 2. Property

| Notion column (assumed) | `cr_properties` | Workspace artifact |
|---|---|---|
| `Name` (title) | `name` | CalResource `resourceName`, Drive name |
| `Portfolio` (relation) | `portfolio_id` | OU path prefix |
| `Address` (text) | `address` | CalResource `userVisibleDescription` |
| `City` | `city` | — |
| `State` | `state` | — |
| `ZIP` | `zip` | — |
| `Type` (select) | `property_type` | CalResource `resourceType` qualifier |
| `Status` (select) | `status` | Shared Drive active/archived flag |
| `Jurisdiction` | `jurisdiction` | — |
| `Description` | `description` | — |
| `Airbnb ID` | `airbnb_id` | iCal pull URL secret |
| `Furnished Finder ID` | `furnished_finder_id` | iCal pull URL secret |
| `Zillow ID` | `zillow_id` | — |
| `Booking.com ID` | `booking_id` | iCal pull URL secret |
| `VRBO ID` (new — add to Notion) | `metadata.vrbo_id` | iCal pull URL secret |
| `Bedrooms` | `bedrooms` | CalResource capacity hint |
| `Bathrooms` | `bathrooms` | — |
| `Sqft` | `sqft` | — |
| `Amenities` (multi-select) | `amenities` (jsonb) | CalResource `featureInstances` |
| `Images` (files) | `images` (jsonb) | Drive: `Photos/` bootstrap |
| `Default rent` | `rent_amount` | — |
| `Deposit` | `security_deposit_amount` | — |
| `External ID` (DoorLoop) | `external_id` | — |
| `ChittyGov Asset` | `gov_asset_id` | — |
| `ChittyFinance Property` | `cf_property_id` | — |
| — | `metadata.shared_drive_id` † | Drive ID populated after Phase 1 |
| — | `metadata.home_assistant_webhook` § | Owner-provided webhook URL for fan-out |

**Flow:** Notion ⟶ `cr_properties` ⟶ GAM + Calendar + Drive.

## 3. Unit

| Notion (assumed, separate DB or inline child) | `cr_units` | Workspace artifact |
|---|---|---|
| `Unit #` | `unit_number` | CalResource name suffix |
| `Property` (relation) | `property_id` | — |
| `Bedrooms` | `bedrooms` | CalResource capacity |
| `Bathrooms` | `bathrooms` | — |
| `Sqft` | `sqft` | — |
| `Floor` | `floor` | — |
| `Status` | `status` | — |
| — | `id` (uuid) | CalResource `resourceId`, view calendar id |
| — | derived † | `resourceEmail` = `unit-{id8}@resources.chitty.cc` |

**Flow:** Notion ⟶ `cr_units` ⟶ Calendar Resource + view calendars.

## 4. Lease (not in Notion — cr_* is SoT)

| `cr_leases` | Calendar event |
|---|---|
| `id` | `chitty.id`, `chitty.type = lease:*` |
| `unit_id` | target calendar |
| `tenant_id` | attendee (tenant) |
| `lease_type` | event title qualifier |
| `start_date` | `lease:move_in` event start |
| `end_date` | `lease:move_out` event start |
| `status` | `chitty.status` |

## 5. Maintenance (not in Notion — cr_* is SoT)

| `cr_maintenance` | Calendar / Tasks / Chat |
|---|---|
| `id` | `chitty.id` |
| `property_id` / `unit_id` | target calendar |
| `assigned_to` | Tasks assignee, event attendee |
| `title` | event + task title |
| `priority` | Chat card color (low/medium/high/urgent) |
| `status` | `chitty.status`, Task done-state |

## 6. Inventory (Google Sheet — `cr_assets` is SoT)

See [`gam-inventory-lifecycle.md`](./gam-inventory-lifecycle.md) §"Sheet
schema" for per-column mapping. Key fields:

| Sheet `Master` col | `cr_assets` |
|---|---|
| D — Name | `name` |
| E — Category | `asset_type` |
| F — Model | `model` |
| G — Serial | `serial_number` |
| I — Purchase date | `purchase_date` |
| J — Purchase price | `purchase_price` |
| K — Warranty until | `warranty_expiration` |
| L — Status | `status` (lifecycle) |

## 7. Calendar event `extendedProperties.private`

Every event the Worker creates on any unit / view calendar carries:

| Key | Value |
|---|---|
| `chitty.type` | `booking:{channel}` \| `lease:*` \| `maintenance:*` \| `inspection:*` \| `rent:*` \| `vrf:review` \| `turnover:*` \| `owner:block` \| `access:smart_lock_code_rotate` |
| `chitty.id` | originating `cr_*` row id (uuid) |
| `chitty.unit_id` | `cr_units.id` |
| `chitty.property_id` | `cr_properties.id` |
| `chitty.status` | current status of the originating row |
| `chitty.source` | `chittyrental` \| channel name |
| `chitty.asset_id` | (inventory-only) `cr_assets.id` |
| `chitty.hmac` | HMAC so reconcile can verify authenticity |

Events not carrying `chitty.source` are assumed human-authored in Calendar
and get imported into `cr_*` only if an operator confirms via Chat slash
command.

## 8. GAM CSV field map

Used by `scripts/gam/templates/*.csv`. Columns match what GAM expects for
batch commands.

### `ous.csv`

```
name,parentOrgUnitPath,description
{portfolio-slug},/ChittyRental,Portfolio: {portfolio.name}
{property-slug},/ChittyRental/{portfolio-slug},Property: {property.name}
```

### `groups.csv`

```
email,name,description
{portfolio-slug}-owners@chitty.cc,"{portfolio.name} — Owners",Owners group
{portfolio-slug}-managers@chitty.cc,"{portfolio.name} — Managers",Managers
{portfolio-slug}-vendors@chitty.cc,"{portfolio.name} — Vendors",Vendors
{property-slug}-tenants@chitty.cc,"{property.name} — Tenants",Active tenants
```

### `resources.csv`

```
resourceId,resourceName,resourceEmail,resourceType,resourceCategory,resourceDescription,buildingId,capacity,featureInstances
cr-unit-{id8},"{property.name} — {unit_number}",unit-{id8}@resources.chitty.cc,Rental Unit,OTHER,"chitty:{cr_units.id}",{property-slug},{capacity},{amenity1;amenity2}
```

`resourceDescription` carries the `chitty:{cr_units.id}` marker used by the
reconcile job to pair GAM rows back to `cr_units` even if email or name is
changed downstream.

### `buildings.csv` (one per property)

```
buildingId,buildingName,description,floorNames,coordinates
{property-slug},{property.name},"{address}",1;2;3;,{lat};{lng}
```

## 9. Config files that encode the mapping

- `src/lib/notion-mapping.ts` — Notion property-id → logical field name.
- `src/lib/inventory-mapping.ts` — Sheet tab/col → `cr_assets` field.
- `src/lib/gam.ts` — `cr_*` → GAM CSV row builder.
- `src/lib/calendar-hub.ts` — `cr_*` → Calendar event builder, incl.
  `extendedProperties`.

Each file exports constants at the top that an operator can edit without
touching the business logic.
