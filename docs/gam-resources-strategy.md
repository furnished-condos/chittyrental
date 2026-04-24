# GAM Resources Strategy & Execution — ChittyRental

**Status:** Draft v2 (2026-04)
**Owner:** ChittyRental (`rental.chitty.cc`)
**GAM tool:** [GAMADV-XTD3](https://github.com/taers232c/GAMADV-XTD3)
**Planning surfaces:**
- Notion DB `cb6da6660e854792abcb81157920600b` — property/unit plan of record
- Google Sheet `1Zsu533Uy498ekbXdWpMuw8xIPAl5MCjf7mxFYkznyWI` — inventory draft
**Systems of record:** `cr_portfolios`, `cr_properties`, `cr_units`, `cr_assets` in Neon PostgreSQL
**Calendar as availability SoT:** the Calendar Resource's primary calendar is the source of truth for each unit's availability; Airbnb, Furnished Finder, VRBO, Booking.com, etc., sync bidirectionally via iCal feeds mediated by this Worker.

> **Important:** The actual Notion property IDs are **not yet encoded** in this
> doc — the integration reads them from `src/lib/notion-mapping.ts`, which
> ships with placeholder field names. Fill that file in with the real Notion
> property IDs before the first `apply` run. See
> [`gam-schema-mapping.md`](./gam-schema-mapping.md).

---

## 1. Goal

Use Google Apps Manager (GAM) to provision and reconcile the Google Workspace
artifacts that mirror ChittyRental's operational hierarchy — so that every
property and unit in the system has a matching, auditable Workspace footprint:

- An **Organizational Unit** for isolation and policy targeting
- A **Calendar Resource** (bookable room/equipment) for showings, turnovers,
  and vendor scheduling
- **Groups** for role-based comms (owners, managers, tenants, vendors) with
  stable mail aliases
- A **Shared Drive** for property documents (leases, inspections, photos)

The Notion database is the planning/review surface. The Neon DB is the system
of record. GAM-managed Workspace objects are the execution surface.

```
Notion DB (plan)  ──►  chittyrental API  ──►  cr_* tables (record)
                            │                       │
                            │                       ▼
                            │                  desired-state CSV
                            │                       │
                            ▼                       ▼
                       reconcile diff  ◄──  GAM CLI (execution)
                            │                       │
                            └──────── audit ────────┘
                                (cr_sync_log)
```

## 1a. Why Google Workspace Resources?

A Google Workspace **Calendar Resource** maps naturally to a rental unit:

- It has its own **primary calendar** — the unit's master availability.
- It has a stable **resource email** (`unit-xxx@resources.chitty.cc`) that any
  Workspace user or external iCal consumer can subscribe to.
- It supports **features** (amenities), **capacity**, **building** grouping,
  and **category** for search — a perfect mirror for
  `cr_properties.amenities` / `bedrooms` / `property_type`.
- It participates in **domain search and room-finder UIs** — customers and
  staff find units through the normal Google Workspace surface.
- It's **ACL-controllable** via the Calendar API — owners, managers, and the
  booking-sync service account get differentiated access.
- It's **free** (no extra license) within an existing Workspace subscription.

Making the unit's calendar resource the availability SoT lets us collapse a
class of multi-channel booking bugs: Airbnb, Furnished Finder, VRBO, and
Booking.com each pull from and push to **one** calendar instead of a
star-shaped pairwise sync.

## 2. Why GAM (not Admin SDK directly)?

- GAM already encodes a defensible operational pattern (batch CSVs, redo logs,
  OAuth scopes scoped to the domain-wide-delegated service account).
- Cloudflare Workers cannot shell out, so the Worker computes **desired state**
  and the operator (or a runner box / GitHub Action) runs GAM. This keeps the
  privileged service-account key out of the Worker edge.
- Bulk-safe: one CSV, one batch command, deterministic outcome.
- Reversible: `gam redo` style idempotent updates; `create if not exists`
  semantics via batch `verify` step.

## 3. Resource model

### 3.1 Organizational Units

```
/ChittyRental
  /{portfolio.name}                   # e.g. "ItCanBe"
    /{property.slug}                  # e.g. "541-w-addison"
```

- One OU per property (not per unit) — units share the property OU.
- Staff/vendor Workspace accounts attached to a property live under its OU so
  Chrome / Drive policies can target them.

### 3.2 Calendar Resources

One **per unit**, with `property` resources for whole-home properties:

| Field | Source | Example |
|---|---|---|
| `resourceId` | `cr_units.id` (UUID) | `0f…e9` |
| `resourceName` | `{property.name} — Unit {unit_number}` | `541 W Addison — 2F` |
| `resourceEmail` | `unit-{short-id}@resources.chitty.cc` | `unit-0f34e9@…` |
| `resourceType` | Fixed: `Rental Unit` | |
| `resourceCategory` | `OTHER` | |
| `buildingId` | `cr_properties.id` short form | `prop-541addison` |
| `capacity` | `cr_units.bedrooms * 2` (bookable guests) | 4 |
| `featureInstances` | Derived from `cr_properties.amenities` | `WiFi,Parking` |
| `userVisibleDescription` | `cr_properties.address` + unit number | |

### 3.3 Groups (mail aliases)

Per portfolio and per property, four role groups:

- `{scope}-owners@chitty.cc` — owner entity members (from ChittyGov)
- `{scope}-managers@chitty.cc` — property managers
- `{scope}-tenants@chitty.cc` — active tenants (populated from `cr_leases.status = 'active'`)
- `{scope}-vendors@chitty.cc` — vetted vendors

`{scope}` is `{portfolio-slug}` or `{portfolio-slug}-{property-slug}`.

### 3.4 Shared Drives

One Shared Drive per property, named `{portfolio} — {property}`. Structure:
`/Leases`, `/Inspections`, `/Photos`, `/Vendor`, `/Accounting`,
`/Inventory-Receipts`. Drive IDs stored in
`cr_properties.metadata.shared_drive_id` (new JSONB key; no schema migration
needed).

### 3.5 Central availability calendar

In addition to the per-unit resource calendars, a **central read-only
calendar** `availability@chitty.cc` aggregates all units via Calendar's
"add calendar by email". This is the dashboard view for staff. The per-unit
calendar remains the write target.

## 3a. Calendar as the central hub

The unit's Calendar Resource is not just a booking store — it is the central
event hub for everything happening at that unit. Every operational signal
becomes a calendar event, which gives us five things for free:

1. A single auditable timeline per unit (who was there, when, why).
2. Native Google Calendar notifications (email + push) scoped to attendees.
3. iCal fan-out to Airbnb / Furnished Finder / VRBO / Booking.com.
4. iCal fan-out to **Alexa, Google Home, Siri, smart displays** — when a
   staff/owner/tenant links a role-scoped calendar in their device account.
5. A Gemini-queryable surface (`"what's happening at 541 W Addison next
   week?"` via Workspace Gemini).

### 3a.0 Event taxonomy

One calendar, many event kinds. Each event carries
`extendedProperties.private.chitty.type`:

| `chitty.type` | Source | Attendees | Fan-out audience |
|---|---|---|---|
| `booking:airbnb` / `booking:furnished_finder` / `booking:vrbo` / `booking:booking` / `booking:direct` | inbound iCal / lease | tenant + managers | owner, managers |
| `lease:move_in` / `lease:move_out` | `cr_leases` | tenant, manager, cleaner | managers, cleaners, owner |
| `maintenance:visit` | `cr_maintenance` | vendor, manager, optional tenant | vendor, tenant, manager |
| `maintenance:reminder` | recurring (HVAC filter, smoke test) | manager | manager, owner |
| `inspection:move_in` / `inspection:move_out` / `inspection:periodic` | `cr_inspections` | inspector, manager, tenant | manager |
| `rent:due` / `rent:late` | `cr_rent_ledger` | tenant (hidden) | manager (private) |
| `vrf:review` | `cr_vrf_ledger` monthly | owner, manager | owner |
| `turnover:clean` / `turnover:restock` | between bookings | cleaner, manager | cleaner, manager |
| `owner:block` | owner request | owner | owner |
| `access:smart_lock_code_rotate` | lock schedule | manager | manager |

All events carry:

```
extendedProperties.private:
  chitty.type       = one of the above
  chitty.id         = cr_* row id (or external id for channel bookings)
  chitty.unit_id    = cr_units.id
  chitty.property_id = cr_properties.id
  chitty.status     = current status
  chitty.source     = 'chittyrental' | 'airbnb' | 'furnished_finder' | ...
```

### 3a.1 Role-scoped views (how fan-out works)

Each audience gets a **view calendar** populated by server-side copy of the
relevant events from the unit calendar. This keeps one SoT (the unit
resource) while letting people subscribe to just what concerns them:

| View calendar | Populated from | Subscribers |
|---|---|---|
| `tenant-{unit-id}@chitty.cc` | `lease:*`, `maintenance:*` where tenant attends, `inspection:*`, `access:*` | current tenant(s) only |
| `owner-{property-id}@chitty.cc` | `booking:*` (summary only), `vrf:review`, `owner:block`, `maintenance:reminder`, `lease:move_*` | property owners |
| `vendor-{vendor-id}@chitty.cc` | `maintenance:visit` assigned to them | vendor |
| `manager-{portfolio-id}@chitty.cc` | all non-`rent:*` | portfolio managers |
| `ops-all@chitty.cc` | aggregate of all unit calendars | internal ops |

View calendars are populated by a scheduled Worker cron that iterates events
from the unit calendar with a lookahead window (T+60d) and upserts into the
view calendar. Deletion on the unit side triggers deletion on views via the
same cron pass.

### 3a.2 Fan-out to Alexa / Google Home / smart displays

Because view calendars are just standard Google calendars, they work out of
the box with:

- **Alexa** — user links their Google account in the Alexa app → view
  calendar shows up in "My Calendar" skill. Announcements via Alexa's
  briefing ("At 10am: plumber visit at 541 W Addison").
- **Google Assistant / Nest Hub** — automatically surfaced once the Google
  account is linked.
- **Apple CarPlay / Siri** — via Google account sync on iOS.

For **property-owned Echo devices** (in-unit Alexa for tenants/owners), we
keep this option open but don't block the v1:

- **Alexa Smart Properties API** — programmatic announcements to a unit's
  Echo device (e.g. "Your cleaning crew is 10 minutes away"). Requires an
  Amazon developer account and per-unit Echo provisioning; parked as Phase 4.

For a simple v1 push path we also expose a webhook:

```
POST /api/gam/fanout
{ unit_id, type, title, body, audiences: ["tenant","owner","manager"] }
```

which relays to:

- Google Calendar as a non-blocking event (with popup notification).
- `cr_comms` for SMS/email via existing OpenPhone integration.
- An optional **Home Assistant webhook** (per-property URL stored in
  `cr_properties.metadata.home_assistant_webhook`) that the owner's smart
  home can route to Alexa Notify, Google Home broadcast, Sonos, etc.

### 3a.3 Booking calendar sync (airbnb/vrbo/etc.)

Per-unit resource calendar is the single source of truth for availability.
External channels sync through this Worker, not peer-to-peer.

### 3a.3.1 Inbound (external channel → unit calendar)

Each external channel exposes an iCal URL per listing (Airbnb, Furnished
Finder, VRBO, Booking.com). The Worker pulls them on a schedule:

```
GET  /api/gam/ical/pull
     ?unit_id={uuid}     — refresh a single unit
     (no param)           — refresh all active listings
```

For each channel feed:

1. Fetch iCal via `fetch()` (5s timeout, retry once).
2. Parse VEVENT blocks → `{ uid, start, end, summary, source }`.
3. Compare against the unit's Google Calendar events tagged
   `source=channel:{name}` in extendedProperties.
4. Insert new events, update moved events, cancel removed events.
5. Write a `cr_sync_log` entry with counts.

Conflicts (overlapping reservations from two channels) are **not** auto-
resolved; they are flagged to `cr_sync_log.error_message` and a notification
is sent to `managers@chitty.cc`.

### 3a.3.2 Outbound (unit calendar → external channels)

Two-way sync is via iCal export. The Worker publishes a signed iCal URL
per unit that each channel subscribes to:

```
GET  /api/gam/ical/export/{unit_id}.ics?sig={hmac}
```

The URL:

- Is deterministic per unit (HMAC of `unit_id` + `ICAL_SECRET`).
- Returns **only busy blocks** (no PII — blocks are titled "Unavailable").
- Includes manual blocks (`cr_leases`, owner blocks, maintenance windows).
- Includes inbound bookings from other channels so the channel doing the
  polling doesn't double-book its own reservations.
- Has a short `Cache-Control: max-age=60` so channels pick up changes fast.

### 3a.3.3 Write-through from leases / maintenance

Whenever an application writes to `cr_leases` (signed), `cr_maintenance`
(requires unit access), or the manual block API, the Worker creates a
corresponding Calendar event via `calendar.events.insert` scoped to the
unit's resource calendar. Event `extendedProperties.private` carries:

- `chitty.type` = `lease | maintenance | manual | channel:airbnb | ...`
- `chitty.id` = originating `cr_*` row id
- `chitty.status` = current status

This lets the iCal export emit the correct busy reason and the reconcile job
detect drift.

### 3a.3.4 Customer-facing availability

Public availability widgets embed a signed iCal URL or query
`/api/gam/availability/{unit_id}?from=YYYY-MM-DD&to=YYYY-MM-DD` which
returns busy ranges only. No calendar ACL is granted to public users.

## 3b. Workspace integrations (tied to resources)

Each Calendar Resource is the anchor; the other Workspace surfaces attach to
it so a customer or staffer touching any one of them gets the full context.
Full details in [`gam-integrations.md`](./gam-integrations.md).

### 3b.1 Google Tasks

- A **task list per property** (`{property.slug}-tasks`) owned by the
  portfolio manager. Tasks are created when:
  - `cr_maintenance` status = `open` → task assigned to the vendor.
  - `cr_inspections.inspection_date` is ~7 days out → prep task to manager.
  - `cr_rent_ledger.status = 'late'` → follow-up task to manager.
  - `cr_vrf_ledger.status = 'underfunded'` → owner review task.
- Tasks surface in Gmail/Calendar sidebar and the Tasks mobile app.
- Calendar events of type `maintenance:*` and `inspection:*` get a linked
  task (via `tasks.tasks.insert` with the event's `htmlLink` as note).

### 3b.2 Google Drive (Shared Drives)

- One Shared Drive per property (see §3.4).
- Drive folder IDs exposed via `GET /api/gam/drive/{property_id}` so the
  frontend can deep-link to folders (e.g. "View this property's leases").
- Maintenance photos auto-filed: `POST /api/maintenance/.../photos` writes
  to `drive://{property}/Inventory-Receipts/{YYYY-MM}/...`.
- `cr_properties.metadata.shared_drive_id` stores the drive ID.

### 3b.3 Gemini

- **Gemini for Workspace** queries work natively because the data lives in
  Workspace: "Show maintenance at 541 W Addison last month", "Summarize
  lease activity for ItCanBe portfolio Q1".
- **ChittyRental embedded Gemini** (Gemini API): used server-side for:
  - Categorizing `cr_transactions` (already present: `ai_categorized`).
  - Summarizing `cr_maintenance` threads into a timeline card.
  - Drafting tenant comms (reviewed before send).
  - Inventory optimization recommendations (see §3c).
- Model: default to the latest Gemini generally-available model via Vertex
  AI; keep the model ID in `GEMINI_MODEL` env var for easy swap.
- Quotas and cost accounted in `cr_sync_log.metadata.gemini_tokens`.

### 3b.4 Google Chat

- One **Space per portfolio** (`{portfolio}-ops`) for staff.
- One **Space per property** (`{property.slug}`) for operational comms
  across owners + managers + (optionally) active tenant.
- Bot: `chittyrental@chitty.cc` posts structured cards:
  - New booking received (with channel + dates + unit deep-link).
  - Maintenance reported (with photo thumbnails from Drive).
  - Rent late threshold crossed.
  - Daily digest 08:00 per portfolio.
- Space membership managed by GAM groups — joining
  `{property}-managers@chitty.cc` adds you to the property Space.

### 3b.5 Gmail

- Group aliases (§3.3) route email to the right people.
- Inbound email to `maintenance@{property}.chitty.cc` (catch-all) parses
  into a `cr_maintenance` row via a Pub/Sub push (or Gmail API polling
  from the Worker).

### 3b.6 Google Forms

- **Move-in inspection** form → writes to `cr_inspections` via Apps Script
  webhook → Worker.
- **Maintenance request** form for tenants without the app → same path.

### 3b.7 Apps Script

- Minimal glue layer:
  - Form → Worker webhook (`POST /api/gam/form-submit`).
  - Drive "file added to Inventory-Receipts" → Worker webhook
    (`POST /api/gam/inventory-receipt`).
- Script code lives under `scripts/apps-script/` with `clasp` config for
  version control.

## 3c. Inventory management lifecycle

Inventory (appliances, furniture, consumables, smart-home gear) is tracked
in `cr_assets` as the SoR. The Google Sheet
`1Zsu533Uy498ekbXdWpMuw8xIPAl5MCjf7mxFYkznyWI` is the **draft/planning
surface** — operators can bulk-edit there, the Worker reconciles into
`cr_assets` via a read-only pull. Full spec in
[`gam-inventory-lifecycle.md`](./gam-inventory-lifecycle.md).

### 3c.1 Lifecycle states

```
planned → ordered → received → deployed → active
                                            │
                                            ├── repair → active | retired
                                            ├── missing → found | written_off
                                            └── end-of-life → retired | sold
```

These map to `cr_assets.status` (which currently is `active|repair|retired|
sold` — we extend values via the application layer without schema change).

### 3c.2 Attach to calendar & tasks

Each asset has two optional calendar event generators:

- **Preventive maintenance** — cron generates `maintenance:reminder` events
  on the unit calendar (e.g. "HVAC filter — Unit 2F").
- **Warranty expiration** — single event 30 days before
  `cr_assets.warranty_expiration`, attendees = owner + manager.

Generated events carry `chitty.type = maintenance:reminder`,
`chitty.asset_id = cr_assets.id`.

### 3c.3 Optimization signals

The Worker runs a weekly optimization pass per property that writes a
report into `cr_financial_reports` (type `inventory_optimization`):

- Replacement vs. repair cost comparison (uses `cost_estimate` history from
  `cr_maintenance`).
- Depreciation per asset (straight-line on `purchase_price` +
  `asset_type` default life).
- Stock reorder flags for consumables below `metadata.reorder_threshold`.
- Vendor performance (avg days-to-complete per vendor).
- Gemini-generated narrative summary in `ai_insights`.

### 3c.4 Sheet → DB reconciliation

```
GET  /api/gam/inventory/sync?dry_run=true
POST /api/gam/inventory/sync
```

Pulls the sheet via the Sheets API using the same Google service account
that GAM uses (domain-wide delegation scope
`https://www.googleapis.com/auth/spreadsheets.readonly`). The JWT is signed
inside the Worker using Web Crypto (RS256), no external signing service.
Mapping from sheet columns to `cr_assets` fields lives in
`src/lib/inventory-mapping.ts` and must be filled in once the sheet schema
is confirmed.

## 4. Notion ↔ ChittyRental ↔ GAM alignment

The Notion DB is the editorial surface — humans add new properties/units
there, decide cap levels, assign portfolios. ChittyRental pulls Notion rows
through the MCP gateway (`NOTION_GATEWAY_URL`), normalizes them via
`src/lib/notion-mapping.ts`, and upserts into `cr_properties` / `cr_units`.
From that record, GAM desired state is derived.

**Direction of truth:**

| Field | Truth | Updates flow |
|---|---|---|
| Property exists, address, portfolio | Notion | Notion → cr_* |
| Unit count, bedrooms, sqft | Notion | Notion → cr_* |
| Occupancy, lease status | cr_* | cr_* → Notion (status field only) |
| Calendar resource email / OU path | cr_* (derived) | cr_* → GAM → back-written to Notion |
| Amenities list | Notion | Notion → cr_* → GAM feature instances |

A record is never deleted by GAM sync. Deletions require a status change to
`inactive` in Notion + human approval; the reconcile report flags orphans.

## 5. Execution phases

### Phase 0 — Bootstrap (one-time)

```bash
scripts/gam/bootstrap-ous.sh          # /ChittyRental root + per-portfolio OUs
scripts/gam/bootstrap-groups.sh       # Portfolio-level role groups
```

Run from an operator workstation with GAM configured against `chitty.cc`.
Output logged to `cr_sync_log` via `POST /api/gam/log`.

### Phase 1 — Provision (per new property)

1. Add row to Notion DB, set Status = `setup`.
2. `POST /api/gam/sync-notion` — Worker pulls Notion, upserts `cr_properties`
   + `cr_units` rows, writes a desired-state CSV into KV key
   `gam:desired:{timestamp}`.
3. Operator runs `scripts/gam/provision-resources.sh {timestamp}` — pulls
   CSV, runs `gam batch` to create OU + groups + calendar resources + shared
   drive.
4. Operator posts the GAM output back: `POST /api/gam/reconcile` with the
   `gam print resources` CSV. Worker diffs, updates `cr_sync_log`.

### Phase 2 — Ongoing sync (scheduled)

Worker cron (every 15m):

- `sync-notion` — refresh from Notion (additions, status changes)
- `export-desired-state` — write CSV to KV (TTL 1h)
- Emit webhook to runner if diff is non-empty

Runner (cron or GitHub Action) every hour:

- Pull CSV, run `gam batch` with `create if not exists` + `update`.
- Post `gam print resources` back to `/api/gam/reconcile`.

### Phase 3 — Decommission

Status `inactive` in Notion → Worker marks `cr_properties.status = 'inactive'`
but **does not** emit a GAM delete. Operator runs `scripts/gam/retire.sh {id}`
after approval, which:

1. Exports calendar for archival.
2. `gam update resource … hidden true` (no delete — preserves audit trail).
3. Transfers Shared Drive ownership to `archives@chitty.cc`.
4. Moves OU to `/Archive/{year}`.

## 6. Security & secrets

| Secret | Where | Purpose |
|---|---|---|
| `NOTION_GATEWAY_TOKEN` | `wrangler secret put` | Auth to `mcp.ch1tty.com` |
| `NOTION_DATABASE_ID` | `wrangler secret put` | Which Notion DB to sync |
| `GOOGLE_SA_KEY` | `wrangler secret put` (base64 JSON) | Service account JSON with domain-wide delegation for Sheets/Calendar/Drive/Tasks/Chat read+write. The same SA GAM delegates from. |
| `GOOGLE_SA_SUBJECT` | `wrangler secret put` | Admin user to impersonate (`gam@chitty.cc`) for directory-scoped calls |
| `INVENTORY_SHEET_ID` | `wrangler secret put` | `1Zsu533Uy498ekbXdWpMuw8xIPAl5MCjf7mxFYkznyWI` |
| `ICAL_SECRET` | `wrangler secret put` | HMAC key for signing per-unit iCal export URLs |
| `GEMINI_API_KEY` | `wrangler secret put` | For server-side Gemini calls |
| `GEMINI_MODEL` | `[vars]` | Pinned model ID (overridable) |
| `GAM_OAUTH_ADMIN` | Workstation | `gam@chitty.cc` delegated admin, CLI-side only |

Worker ↔ gateway calls carry `X-Source-Service: chittyrental` + Bearer token,
matching the pattern in `src/lib/clients.ts`.

GAM service account scopes (minimum):

- `admin.directory.orgunit`
- `admin.directory.group`
- `admin.directory.group.member`
- `admin.directory.resource.calendar`
- `drive` (for Shared Drive creation — scoped to the delegated admin only)

## 7. Audit & observability

Every sync run writes a `cr_sync_log` row:

```
source          = 'gam'
sync_type       = 'resources' | 'groups' | 'ous' | 'drives'
direction       = 'outbound' | 'inbound' | 'bidirectional'
status          = 'pending' | 'running' | 'completed' | 'failed'
records_synced  = diff count
error_message   = last error
```

Calendar resources carry a `resourceDescription` tag `chitty:{cr_units.id}`
so that `gam print resources` can be joined back to `cr_units` without
relying on email format.

## 8. Rollback

- **Phase 0 bootstrap:** OUs and groups are safe to recreate; no destructive
  ops. Rollback = `gam delete ou /ChittyRental/...` only after evacuation.
- **Phase 1 provisioning:** If CSV is wrong, re-run with corrected desired
  state — GAM `create if not exists` makes it idempotent. `update` uses last
  row wins.
- **Phase 2 sync:** Every apply is preceded by a `dry-run` diff posted to
  `cr_sync_log`. A failed apply leaves prior state intact.
- **Phase 3 decommission:** Hiding (not deleting) preserves a 90-day recovery
  window before OU archive cleanup.

## 9. Open questions

- **Notion schema confirmation.** `src/lib/notion-mapping.ts` has placeholder
  field names; need the real Notion property IDs. Pull them from the DB JSON
  response, or open the DB in Notion → `…` → "Copy link to view" and inspect
  the query response.
- **Runner location.** Do we host a dedicated runner box, use GitHub Actions,
  or call out to an operator's workstation? GitHub Actions is simplest
  (secrets in repo), but slow. Runner box is faster but needs its own uptime
  story.
- **Tenant group membership.** Should `*-tenants@chitty.cc` auto-populate
  from `cr_leases` (privacy concern: shared visibility) or stay opt-in?
- **Multi-portfolio property.** Notion schema currently assumes 1:1 property
  → portfolio. Do we need a many-to-many for co-owned assets?

## 10. Related

- [`gam-schema-mapping.md`](./gam-schema-mapping.md) — column-by-column map
- [`gam-integrations.md`](./gam-integrations.md) — Tasks/Drive/Gemini/Chat/Alexa fan-out details
- [`gam-inventory-lifecycle.md`](./gam-inventory-lifecycle.md) — inventory plan + sheet mapping
- [`scripts/gam/README.md`](../scripts/gam/README.md) — operator runbook
- `src/routes/gam.ts` — Worker endpoints (GAM + Notion sync)
- `src/routes/calendar.ts` — iCal pull/export, view-calendar fan-out
- `src/lib/gam.ts` — desired-state builder + diff
- `src/lib/calendar-hub.ts` — Calendar API write-through + event taxonomy
- `src/lib/google-sa.ts` — service account JWT signing (RS256 via Web Crypto)
- `src/lib/notion.ts` — gateway client
- `src/lib/inventory-mapping.ts` — Sheets → cr_assets mapping
