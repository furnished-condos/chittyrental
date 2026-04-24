# Google Workspace Integrations — ChittyRental

Companion to [`gam-resources-strategy.md`](./gam-resources-strategy.md).
This doc specifies how each Workspace surface attaches to a rental unit's
Calendar Resource and cr_* rows, plus the fan-out to home devices (Alexa,
Google Home, etc.).

## Guiding principle

The **Calendar Resource per unit** is the anchor. Every other Workspace
object links back to either `chitty.unit_id` or `chitty.property_id`
through event `extendedProperties`, Drive folder names, group aliases,
Task links, or Chat Space topic metadata. This lets a user touching any
one surface reach the unit's full context in one hop.

## 1. Google Tasks

### 1.1 Model

- One **task list per property**, owned by the portfolio manager account.
- Task naming: `{emoji} {type}: {title}` for quick visual scan.
- Task due-date = corresponding calendar event start.
- Task `notes` contains a deep link to the `cr_*` row +
  `htmlLink` of the calendar event.

### 1.2 Generators (Worker cron + write-through)

| Trigger | Task |
|---|---|
| `cr_maintenance` created | Assign to vendor; due = `created_at + 3d` |
| `cr_inspections` scheduled | 7-day prep reminder to manager |
| `cr_rent_ledger.status = 'late'` | Follow-up reminder to manager |
| `cr_vrf_ledger.status = 'underfunded'` | Monthly owner review |
| `cr_assets.warranty_expiration` ~30d | Decide: renew, replace, self-insure |
| `cr_leases.end_date` ~60d | Renewal outreach |

### 1.3 API surface

```
POST /api/gam/tasks/sync          — one-shot re-evaluation
GET  /api/gam/tasks/property/{id} — list open tasks for a property
```

Backed by Google Tasks API v1 via service account.
Scopes: `https://www.googleapis.com/auth/tasks`.

## 2. Google Drive (Shared Drives)

### 2.1 Per-property Shared Drive

Created during Phase 1 provisioning. Standard folder layout:

```
{Portfolio} — {Property}/
├── Leases/
├── Inspections/{YYYY}/
├── Photos/{YYYY-MM}/
├── Vendor/{vendor-slug}/
├── Accounting/{YYYY}/
├── Inventory-Receipts/{YYYY-MM}/
└── Tenant-Facing/           # shared with current tenant group only
```

### 2.2 ACLs (via GAM)

- `{portfolio}-owners@chitty.cc` — Content Manager on all property drives
  in the portfolio.
- `{property}-managers@chitty.cc` — Content Manager on this drive.
- `{property}-tenants@chitty.cc` — Viewer on `Tenant-Facing/` only (via
  permission on that folder; Shared Drive default ACL stays restricted).
- `chittyrental@chitty.cc` (service bot) — Content Manager for write-through.

### 2.3 Write-through from app

| Source | Destination |
|---|---|
| `POST /api/maintenance/{id}/photos` | `Photos/{YYYY-MM}/maint-{id}-{n}.jpg` |
| `POST /api/leases/{id}/sign` | `Leases/{tenant-slug}-{YYYY}.pdf` |
| `POST /api/inspections/{id}/report` | `Inspections/{YYYY}/{type}-{date}.pdf` |
| Inventory receipt forward to `inventory@chitty.cc` | `Inventory-Receipts/{YYYY-MM}/...` |

Drive IDs persisted in `cr_properties.metadata.shared_drive_id`.
Scopes: `https://www.googleapis.com/auth/drive`.

## 3. Gemini

### 3.1 Surfaces

**A. Workspace-native Gemini** (user-facing, no code):

- Works automatically for any user who has Gemini in their Workspace plan.
- Because Calendar / Drive / Gmail / Chat / Tasks are all populated with
  chitty context, prompts like *"What's happening at 541 W Addison next
  week?"* or *"Summarize maintenance at ItCanBe portfolio in Q1"* work.
- No integration code — just make sure data is in the right places.

**B. Embedded server-side Gemini** (ChittyRental-initiated):

- Called from the Worker via the Gemini API.
- Responses stored in the cr_* row with `ai_*` columns (already exist on
  `cr_transactions`, `cr_setup_sessions`, `cr_financial_reports`).

### 3.2 Server-side use cases

| Use case | Input | Output → |
|---|---|---|
| Transaction categorization | `cr_transactions.description` + amount | `category`, `ai_confidence` |
| Maintenance timeline summary | all `cr_maintenance` + `cr_comms` for a unit | card posted to property Chat space |
| Tenant comms draft | context + intent | `draft` returned for human approval (never auto-sent) |
| Inventory optimization | sheet + `cr_assets` + `cr_maintenance` history | narrative in `cr_financial_reports.ai_insights` |
| Lease abstract | signed lease PDF from Drive | structured JSON into `cr_leases.metadata.abstract` |

### 3.3 Model selection & cost

- Env var `GEMINI_MODEL` pins the model ID. Start with a fast model for
  categorization, a thinking model for optimization summaries.
- Every call records `cr_sync_log.metadata.gemini = { model, input_tokens,
  output_tokens }` so cost is attributable.
- Per-property monthly cap in `cr_properties.metadata.gemini_monthly_cap`;
  the Worker short-circuits with `ai_confidence = null` when the cap is
  exceeded (degrades gracefully, doesn't block).

### 3.4 Safety

- Never pass raw tenant PII to Gemini unless absolutely necessary. For
  comms drafts, names are passed; SSNs / bank info never.
- Outputs always labeled `ai_*` so human reviewers know the source.

## 4. Google Chat

### 4.1 Spaces

| Space | Members | Purpose |
|---|---|---|
| `#{portfolio}-ops` | managers, owners (optional) | Portfolio daily ops |
| `#{property.slug}` | property managers + tenant(s) + optional owner | Per-property thread |
| `#vendors-{portfolio}` | managers + recurring vendors | Vendor comms |
| `#inspections` | inspectors + managers | Scheduling, reports |
| `#incidents` | on-call rotation | Emergency maintenance |

### 4.2 ChittyRental bot

`chittyrental@chitty.cc` — a Chat app that posts cards and accepts slash
commands.

**Cards it posts:**

- `📅 New booking — {channel} — {unit} — {dates}` (source: iCal pull)
- `🔧 Maintenance reported — {priority} — {unit}` with photos + a
  "Claim" button that sets `assigned_to`
- `💰 Rent late — {tenant} — {unit} — Day {n}` (private to managers)
- `🧹 Turnover needed — {unit} — {checkout}` (cleaner-tagged)
- `📊 Portfolio digest 08:00` — occupancy, rent collected, open work orders

**Slash commands:**

- `/unit 541-addison-2f` — summary card with current status + next event
- `/book 541-addison-2f 2026-05-01..2026-05-05 ownerblock` — creates an
  `owner:block` event on the unit calendar
- `/maint 541-addison-2f "dishwasher leaking" high` — creates `cr_maintenance`
- `/inventory 541-addison-2f` — current `cr_assets` with status

### 4.3 Space membership = group membership

Spaces use Workspace groups so GAM-managed memberships flow automatically:

```
Space "#{property.slug}"
  members-from-group: {property}-managers@chitty.cc
  members-from-group: {property}-tenants@chitty.cc
```

Scopes: `https://www.googleapis.com/auth/chat.spaces`,
`chat.messages`, `chat.memberships`.

## 5. Gmail

- Group aliases (§3.3 of strategy doc) are the primary email surface.
- Catch-all: `*@{property}.chitty.cc` via Google Domains + Cloudflare
  routes through a Workers Email route into the main Worker, which parses
  and files into `cr_comms` / `cr_maintenance`.
- Tenant-facing threads tagged with `chitty-{tenant-id}` label for easy
  conversation grouping (applied by a Gmail filter configured per manager
  via Apps Script).

## 6. Google Forms

| Form | Webhook target |
|---|---|
| Move-in inspection | `POST /api/gam/form-submit?type=inspection_move_in` |
| Move-out inspection | `POST /api/gam/form-submit?type=inspection_move_out` |
| Maintenance request (tenant) | `POST /api/gam/form-submit?type=maintenance` |
| Prospect inquiry | `POST /api/gam/form-submit?type=lead` |

Forms live in the portfolio's Shared Drive; responses flow via Apps Script
onFormSubmit → Worker webhook.

## 7. Apps Script

Lives in `scripts/apps-script/` (tracked via `clasp`):

- `form-router.gs` — routes form submits to Worker with HMAC.
- `drive-watcher.gs` — on-new-file in `Inventory-Receipts` → Worker.
- `gmail-intake.gs` — per-manager inbox filter for tenant threads.

Each script reads its shared secret from Script Properties (set once via
`clasp deploy`).

## 8. Event fan-out to home devices (Alexa / Google Home / others)

### 8.1 Default path — via role-scoped calendars

Because the view calendars (`tenant-{unit}`, `owner-{property}`, etc.) are
ordinary Google calendars, they work out of the box with:

| Device / surface | How a user enables it |
|---|---|
| **Alexa** (phone + Echo) | Alexa app → Settings → Calendar & Email → Add Google account → pick the view calendar. Alexa announces upcoming events in Briefing and can add via voice. |
| **Google Assistant / Nest Hub / Google TV** | Automatic when the Google account is the device's default; no extra config. |
| **Apple CarPlay, iOS Siri** | Add Google account to iOS Calendar; Siri reads it. |
| **Samsung SmartThings / Bixby** | Link Google account. |
| **Outlook / Windows** | Add via Outlook → Add Calendar → Subscribe from web (use the signed iCal URL). |
| **Sonos / Samsung TV / smart fridges** | Typically iCal subscription. |

### 8.2 Opt-in webhook for richer fan-out

For owners/managers who want event-specific announcements (not just
"upcoming event" briefings), we expose:

```
POST /api/gam/fanout
Authorization: Bearer {service token}
{
  "unit_id": "<uuid>",
  "type": "maintenance:visit" | "booking:checkin" | ...,
  "title": "Plumber arriving",
  "body":  "10am visit for kitchen leak at 541 W Addison.",
  "audiences": ["tenant", "manager"],
  "scheduled_for": "2026-05-01T10:00:00-05:00"  // optional
}
```

The Worker:

1. Creates/updates the calendar event on the unit + view calendars
   (standard notification path — covers native Alexa/Google Home).
2. If `cr_properties.metadata.home_assistant_webhook` is set, POSTs the
   payload there. Home Assistant users can route to Alexa Notify, Google
   Home broadcast, Sonos TTS, Hubitat, etc., based on their own automations.
3. If an audience includes `manager`, also writes to `cr_comms` as channel
   `push` so the internal app surfaces it.

### 8.3 Alexa Smart Properties (Phase 4 — in-unit Echos)

For property-owned Echo devices installed in units, a later phase will
integrate Alexa Smart Properties directly:

- Provision units in Smart Properties (one per `cr_units.id`).
- Map each Echo to a unit via its serial.
- `POST /api/gam/fanout` with audience `unit_echo` → Smart Properties
  `SendAnnouncement` API.
- Useful for: arrival instructions, check-out reminders, package
  notifications, emergency messages.

Prerequisites not yet satisfied: Amazon developer org, per-unit Echo
hardware inventory, Smart Properties SKU.

## 9. Scopes summary

The service account needs these Google OAuth scopes (domain-wide delegated
to `gam@chitty.cc`):

```
admin.directory.orgunit
admin.directory.group
admin.directory.group.member
admin.directory.resource.calendar
admin.directory.user          (read-only)
calendar
drive
tasks
chat.spaces
chat.messages
chat.memberships
spreadsheets.readonly         (for inventory sheet)
gmail.readonly                (for intake; gmail.modify if labeling)
```

Add these in the Admin console → Security → API controls → Domain-wide
delegation for the service account's client ID.
