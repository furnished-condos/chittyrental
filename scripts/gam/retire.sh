#!/usr/bin/env bash
# Decommission a property: hide (not delete) resources, archive drive, move OU.
# Preserves the `chitty:{cr_units.id}` marker in resourceDescription so the
# reconcile job can still correlate retired rows to cr_units.
# Usage: retire.sh <property_id> [--dry-run]
set -euo pipefail

: "${RENTAL_API:?}"; : "${RENTAL_TOKEN:?}"
property_id="${1:?usage: retire.sh <property_id>}"
DRY_RUN=${DRY_RUN:-0}; [[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1

apply() {
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

plan=$(curl -sSf -H "Authorization: Bearer $RENTAL_TOKEN" \
        "$RENTAL_API/api/gam/retire-plan/$property_id")

year=$(date +%Y)
failed=0

# Hide resources (keep resourceDescription intact so the reconcile marker
# survives). GAM accepts `hidden true` on update resource.
while read -r rid; do
  [[ -z "$rid" ]] && continue
  apply gam update resource "$rid" hidden true || failed=1
done < <(echo "$plan" | jq -r '.resources[]')

drive_id=$(echo "$plan" | jq -r '.shared_drive_id // empty')
if [[ -n "$drive_id" ]]; then
  apply gam user gam@chitty.cc update shareddrive "$drive_id" name "ARCHIVE/${year}/$(echo "$plan" | jq -r '.drive_name')" || failed=1
  apply gam user gam@chitty.cc add drivefileacl "$drive_id" user archives@chitty.cc role organizer || failed=1
fi

ou_path=$(echo "$plan" | jq -r '.ou_path')
# Ensure the archive parent OU exists before moving — failure here is expected
# after the first run of the year, hence `|| true`.
apply gam create org "/Archive/${year}" || true
apply gam update org "$ou_path" parent "/Archive/${year}" || failed=1

# Confirm back to the Worker ONLY on a real, fully-successful run. A dry-run
# must not mutate cr_properties.status.
if [[ "$DRY_RUN" == 1 ]]; then
  echo "DRY: would POST /api/gam/retired for $property_id"
elif [[ "$failed" == 0 ]]; then
  curl -sSf -X POST \
    -H "Authorization: Bearer $RENTAL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"property_id\":\"$property_id\",\"retired_at\":\"$(date -u +%FT%TZ)\"}" \
    "$RENTAL_API/api/gam/retired" >/dev/null
  echo "Retired $property_id"
else
  echo "One or more GAM steps failed; not confirming retirement to Worker." >&2
  exit 1
fi
