#!/usr/bin/env bash
# Create the /ChittyRental OU tree from the Worker's desired state.
# Idempotent: GAM "create if not exists" semantics via verify step.
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

: "${RENTAL_API:?set RENTAL_API=https://rental.chitty.cc}"
: "${RENTAL_TOKEN:?set RENTAL_TOKEN=<service token>}"

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

# Pull desired OUs as CSV
curl -sSf \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "X-Source-Service: gam-runner" \
  "$RENTAL_API/api/gam/desired-state/ous.csv" \
  -o "$tmpdir/ous.csv"

wc -l "$tmpdir/ous.csv"

# Log start
curl -sSf -X POST \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sync_type":"ous","direction":"outbound","status":"running"}' \
  "$RENTAL_API/api/gam/log" >/dev/null

apply() {
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

# Root OU
apply gam create org "/ChittyRental" description "ChittyRental managed OUs" || true

# Per-row OU creation (csv: name,parentOrgUnitPath,description). Parsed via
# python's csv module so quoted fields with commas/quotes round-trip.
python3 -c '
import csv, sys
with open(sys.argv[1]) as f:
    for row in csv.DictReader(f):
        print("\t".join([
            row.get("name", ""),
            row.get("parentOrgUnitPath", ""),
            row.get("description", ""),
        ]))
' "$tmpdir/ous.csv" | while IFS=$'\t' read -r name parent desc; do
  apply gam create org "${parent}/${name}" description "$desc" || true
done

# Log success
records=$(tail -n +2 "$tmpdir/ous.csv" | wc -l | tr -d ' ')
curl -sSf -X POST \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sync_type\":\"ous\",\"direction\":\"outbound\",\"status\":\"completed\",\"records_synced\":${records}}" \
  "$RENTAL_API/api/gam/log" >/dev/null

echo "OUs bootstrap complete: $records rows"
