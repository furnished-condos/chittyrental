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

apply() {
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}

urlencode() {
  python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

# GAM can batch-create groups from CSV. Columns: email,name,description
apply gam csv "$tmpdir/groups.csv" gam create group "~email" name "~name" description "~description" || true

# Sync memberships from cr_* via the Worker — one group at a time.
# The Worker returns a headerless, single-column email list (what
# `gam update group ... sync members file` expects). If the endpoint has no
# data for a group it returns an empty body; we skip the sync in that case to
# avoid emptying the group.
tail -n +2 "$tmpdir/groups.csv" | cut -d, -f1 | sort -u | while read -r email; do
  email=${email//\"/}
  enc=$(urlencode "$email")
  members_csv="$tmpdir/members-$(echo "$email" | tr @ _).txt"
  curl -sSf \
    -H "Authorization: Bearer $RENTAL_TOKEN" \
    -H "X-Source-Service: gam-runner" \
    "$RENTAL_API/api/gam/desired-state/group-members.csv?group=$enc" \
    -o "$members_csv"
  if [[ -s "$members_csv" ]]; then
    apply gam update group "$email" sync members file "$members_csv" || true
  else
    echo "skip $email: no desired members returned"
  fi
done

echo "Groups bootstrap complete"
