# GAM Scripts — Operator Runbook

Scripts for the workstation / runner that executes
[GAMADV-XTD3](https://github.com/taers232c/GAMADV-XTD3) against Google
Workspace, using desired-state CSVs produced by the ChittyRental Worker.

**Why here, not in the Worker?** Workers can't spawn processes. The
Worker computes desired state; these scripts apply it using the GAM
service account. This also keeps the privileged SA key off the edge.

## One-time setup

1. Install GAMADV-XTD3 on the runner (use the canonical installer URL — the
   old `git.io/install-gam` shortlink no longer resolves):
   ```bash
   bash <(curl -s -S -L https://raw.githubusercontent.com/taers232c/GAMADV-XTD3/master/src/gam-install.sh) -l
   ```
   If you're starting fresh and prefer GAM7 instead, use
   `https://git.io/gam-install` and adjust the scripts accordingly.
2. Authenticate as the delegated admin:
   ```bash
   gam oauth create
   gam user gam@chitty.cc check serviceaccount
   ```
3. Export the worker endpoint + service token:
   ```bash
   export RENTAL_API=https://rental.chitty.cc
   export RENTAL_TOKEN=<CHITTY_AUTH_SERVICE_TOKEN>
   ```

## Scripts

| Script | Purpose |
|---|---|
| `bootstrap-ous.sh` | Create `/ChittyRental` OU tree from Worker CSV |
| `bootstrap-groups.sh` | Create portfolio + property role groups |
| `provision-resources.sh` | Create Calendar Resources for all known units |
| `provision-buildings.sh` | Create Buildings (one per property) |
| `provision-drives.sh` | Create per-property Shared Drives + folders |
| `sync-from-worker.sh` | Full pull + apply (orchestrates the above) |
| `reconcile.sh` | Export current GAM state, POST to Worker for diff |
| `retire.sh` | Decommission a property (hide resources, archive drive) |

All scripts accept `--dry-run` to print commands without executing.

## Typical flow

```bash
# one-time
./bootstrap-ous.sh
./bootstrap-groups.sh

# per new property (after Notion sync)
./sync-from-worker.sh

# hourly via cron
0 * * * * cd /opt/chittyrental/scripts/gam && ./reconcile.sh
```

## Templates

`templates/*.csv` are the file formats the Worker produces when you hit
`GET /api/gam/desired-state`. They are also what the bootstrap scripts
consume for one-shot runs when the Worker is unreachable.

## Audit

Every script logs to `cr_sync_log` via a `curl` POST at start and end.
Failed runs also write the GAM output to
`gs://chittyrental-gam-logs/{YYYY-MM-DD}/...` (set up separately).
