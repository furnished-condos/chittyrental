#!/usr/bin/env bash
# Create Calendar Resources (one per cr_units row) from Worker's desired state.
# Idempotent: `update if exists, create if not`.
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

: "${RENTAL_API:?set RENTAL_API}"
: "${RENTAL_TOKEN:?set RENTAL_TOKEN}"

tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

curl -sSf \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "X-Source-Service: gam-runner" \
  "$RENTAL_API/api/gam/desired-state/resources.csv" \
  -o "$tmpdir/resources.csv"

# Log start
curl -sSf -X POST \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sync_type":"resources","direction":"outbound","status":"running"}' \
  "$RENTAL_API/api/gam/log" >/dev/null

apply() {
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

# Snapshot current GAM resources, keyed by resourceId
if [[ "$DRY_RUN" == 1 ]]; then
  echo "DRY: gam print resources allfields (skipping live read)"
  : > "$tmpdir/current.csv"
else
  gam print resources allfields > "$tmpdir/current.csv"
fi

# Upsert each desired row. rcat is the resourceCategory (other|room|conference_room).
tail -n +2 "$tmpdir/resources.csv" | while IFS=, read -r rid rname remail rtype rcat rdesc bid cap feat; do
  rid=${rid//\"/}; rname=${rname//\"/}; remail=${remail//\"/}
  rcat=${rcat//\"/}; rdesc=${rdesc//\"/}; bid=${bid//\"/}; feat=${feat//\"/}
  # remail is set on the resource by GAM automatically from the resourceId
  # and Workspace settings; not a parameter to create/update.
  : "$remail"
  if grep -q "^${rid}," "$tmpdir/current.csv"; then
    apply gam update resource "$rid" \
      name "$rname" \
      description "$rdesc" \
      type "$rtype" \
      category "${rcat:-other}" \
      capacity "${cap:-2}" \
      building "$bid" \
      features "$feat" || true
  else
    apply gam create resource "$rid" "$rname" \
      description "$rdesc" \
      type "$rtype" \
      category "${rcat:-other}" \
      capacity "${cap:-2}" \
      building "$bid" \
      features "$feat" || true
  fi
done

records=$(tail -n +2 "$tmpdir/resources.csv" | wc -l | tr -d ' ')
curl -sSf -X POST \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sync_type\":\"resources\",\"direction\":\"outbound\",\"status\":\"completed\",\"records_synced\":${records}}" \
  "$RENTAL_API/api/gam/log" >/dev/null

echo "Provisioned $records resources"
