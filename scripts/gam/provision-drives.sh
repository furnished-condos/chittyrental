#!/usr/bin/env bash
# Create Shared Drives per property + standard folder layout, then POST IDs
# back to the Worker so cr_properties.metadata.shared_drive_id is stored.
set -euo pipefail

: "${RENTAL_API:?}"; : "${RENTAL_TOKEN:?}"
DRY_RUN=${DRY_RUN:-0}; [[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

curl -sSf -H "Authorization: Bearer $RENTAL_TOKEN" \
  "$RENTAL_API/api/gam/desired-state/drives.json" -o "$tmpdir/drives.json"

apply() {
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

jq -c '.[]' "$tmpdir/drives.json" | while read -r row; do
  property_id=$(echo "$row" | jq -r '.property_id')
  drive_name=$(echo "$row" | jq -r '.drive_name')
  managers_group=$(echo "$row" | jq -r '.managers_group')

  # Create the drive (idempotent: lookup first). Name lookup uses python's csv
  # module so comma-containing drive names round-trip correctly.
  drive_id=""
  if [[ "$DRY_RUN" != 1 ]]; then
    existing=$(gam user gam@chitty.cc print shareddrives fields id,name 2>/dev/null \
               | python3 -c '
import csv, sys
target = sys.argv[1]
reader = csv.DictReader(sys.stdin)
for row in reader:
    if row.get("name") == target:
        print(row.get("id", ""))
        break
' "$drive_name")
    if [[ -n "$existing" ]]; then
      drive_id="$existing"
    else
      drive_id=$(gam user gam@chitty.cc create shareddrive "$drive_name" \
                 | awk '/ID:/ {print $2}')
    fi
  else
    echo "DRY: gam user gam@chitty.cc create shareddrive \"$drive_name\""
    drive_id="DRY-RUN-DRIVE-ID"
  fi

  if [[ -z "$drive_id" ]]; then
    echo "ERROR: failed to obtain drive_id for property $property_id ($drive_name)" >&2
    continue
  fi

  # ACLs
  apply gam user gam@chitty.cc add drivefileacl "$drive_id" \
    group "$managers_group" role organizer || true

  # Folder layout. TODO: make folder creation idempotent by first listing
  # children and skipping folders that already exist, to avoid accumulating
  # duplicate siblings on repeated runs. For now we only create on the first
  # provisioning pass; re-runs should be rare.
  for folder in Leases Inspections Photos Vendor Accounting Inventory-Receipts Tenant-Facing; do
    apply gam user gam@chitty.cc add drivefile parent id:"$drive_id" mimetype gfolder drivefilename "$folder" || true
  done

  # Tell the Worker — skip in dry-run so cr_properties.metadata.shared_drive_id
  # is never polluted with a placeholder.
  if [[ "$DRY_RUN" != 1 ]]; then
    curl -sSf -X POST \
      -H "Authorization: Bearer $RENTAL_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"property_id\":\"$property_id\",\"shared_drive_id\":\"$drive_id\"}" \
      "$RENTAL_API/api/gam/drive-provisioned" >/dev/null
  else
    echo "DRY: would POST /api/gam/drive-provisioned for $property_id"
  fi
done

echo "Drives provisioned"
