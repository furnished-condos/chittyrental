#!/usr/bin/env bash
# Decommission a property: hide (not delete) resources, archive drive.
# Usage: retire.sh <property_id>
set -euo pipefail

: "${RENTAL_API:?}"; : "${RENTAL_TOKEN:?}"
property_id="${1:?usage: retire.sh <property_id>}"
DRY_RUN=${DRY_RUN:-0}; [[ "${2:-}" == "--dry-run" ]] && DRY_RUN=1
apply() { [[ "$DRY_RUN" == 1 ]] && echo "DRY: $*" || "$@"; }

plan=$(curl -sSf -H "Authorization: Bearer $RENTAL_TOKEN" \
        "$RENTAL_API/api/gam/retire-plan/$property_id")

year=$(date +%Y)

echo "$plan" | jq -r '.resources[]' | while read -r rid; do
  apply gam update resource "$rid" description "RETIRED $(date +%F)" || true
done

drive_id=$(echo "$plan" | jq -r '.shared_drive_id // empty')
if [[ -n "$drive_id" ]]; then
  apply gam user gam@chitty.cc update shareddrive "$drive_id" name "ARCHIVE/${year}/$(echo "$plan" | jq -r '.drive_name')" || true
  apply gam user gam@chitty.cc add drivefileacl "$drive_id" user archives@chitty.cc role organizer || true
fi

ou_path=$(echo "$plan" | jq -r '.ou_path')
apply gam update org "$ou_path" parent "/Archive/${year}" || true

# Confirm back to Worker
curl -sSf -X POST \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"property_id\":\"$property_id\",\"retired_at\":\"$(date -u +%FT%TZ)\"}" \
  "$RENTAL_API/api/gam/retired" >/dev/null

echo "Retired $property_id"
