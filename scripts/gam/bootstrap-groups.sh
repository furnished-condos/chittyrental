#!/usr/bin/env bash
# Create portfolio + property role groups from the Worker's desired state.
set -euo pipefail

DRY_RUN=${DRY_RUN:-0}
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

: "${RENTAL_API:?set RENTAL_API}"
: "${RENTAL_TOKEN:?set RENTAL_TOKEN}"

tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

curl -sSf \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "X-Source-Service: gam-runner" \
  "$RENTAL_API/api/gam/desired-state/groups.csv" \
  -o "$tmpdir/groups.csv"

apply() { [[ "$DRY_RUN" == 1 ]] && echo "DRY: $*" || "$@"; }

# GAM can batch-create groups from CSV. Columns: email,name,description
apply gam csv "$tmpdir/groups.csv" gam create group "~email" name "~name" description "~description" || true

# Sync memberships from cr_* via the Worker — one group at a time
tail -n +2 "$tmpdir/groups.csv" | cut -d, -f1 | sort -u | while read -r email; do
  email=${email//\"/}
  members_csv="$tmpdir/members-$(echo "$email" | tr @ _).csv"
  curl -sSf \
    -H "Authorization: Bearer $RENTAL_TOKEN" \
    -H "X-Source-Service: gam-runner" \
    "$RENTAL_API/api/gam/desired-state/group-members.csv?group=$email" \
    -o "$members_csv"
  # Columns: member_email,role (MEMBER|MANAGER|OWNER)
  apply gam update group "$email" sync members file "$members_csv" || true
done

echo "Groups bootstrap complete"
