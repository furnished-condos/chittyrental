#!/usr/bin/env bash
# Create Shared Drives per property + standard folder layout, then POST IDs
# back to the Worker so cr_properties.metadata.shared_drive_id is stored.
set -euo pipefail

: "${RENTAL_API:?}"; : "${RENTAL_TOKEN:?}"
DRY_RUN=${DRY_RUN:-0}; [[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

curl -sSf -H "Authorization: Bearer $RENTAL_TOKEN" \
  "$RENTAL_API/api/gam/desired-state/drives.json" -o "$tmpdir/drives.json"

apply() { [[ "$DRY_RUN" == 1 ]] && echo "DRY: $*" || "$@"; }

jq -c '.[]' "$tmpdir/drives.json" | while read -r row; do
  property_id=$(echo "$row" | jq -r '.property_id')
  drive_name=$(echo "$row" | jq -r '.drive_name')
  managers_group=$(echo "$row" | jq -r '.managers_group')

  # Create the drive (idempotent: lookup first)
  existing=$(gam user gam@chitty.cc print shareddrives fields id,name 2>/dev/null \
             | awk -F, -v n="$drive_name" '$2==n{print $1}')
  if [[ -n "$existing" ]]; then
    drive_id="$existing"
  else
    drive_id=$(apply gam user gam@chitty.cc create shareddrive "$drive_name" \
               | awk '/ID:/ {print $2}')
  fi

  # ACLs
  apply gam user gam@chitty.cc add drivefileacl "$drive_id" \
    group "$managers_group" role organizer || true

  # Folder layout
  for folder in Leases Inspections Photos Vendor Accounting Inventory-Receipts Tenant-Facing; do
    apply gam user gam@chitty.cc add drivefile parent id:"$drive_id" mimetype gfolder drivefilename "$folder" || true
  done

  # Tell the Worker
  curl -sSf -X POST \
    -H "Authorization: Bearer $RENTAL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"property_id\":\"$property_id\",\"shared_drive_id\":\"$drive_id\"}" \
    "$RENTAL_API/api/gam/drive-provisioned" >/dev/null
done

echo "Drives provisioned"
