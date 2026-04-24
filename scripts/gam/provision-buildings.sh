#!/usr/bin/env bash
# Create Buildings (one per cr_properties row).
set -euo pipefail

: "${RENTAL_API:?}"; : "${RENTAL_TOKEN:?}"
DRY_RUN=${DRY_RUN:-0}; [[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1
tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

curl -sSf -H "Authorization: Bearer $RENTAL_TOKEN" \
  "$RENTAL_API/api/gam/desired-state/buildings.csv" -o "$tmpdir/buildings.csv"

apply() {
  if [[ "$DRY_RUN" == 1 ]]; then
    echo "DRY: $*"
  else
    "$@"
  fi
}
apply gam csv "$tmpdir/buildings.csv" gam create building "~buildingId" "~buildingName" \
  description "~description" floors "~floorNames" coordinates "~coordinates" || true

echo "Buildings done."
