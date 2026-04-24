#!/usr/bin/env bash
# Export current GAM state, POST to Worker /api/gam/reconcile for diff.
set -euo pipefail

: "${RENTAL_API:?}"; : "${RENTAL_TOKEN:?}"
tmpdir=$(mktemp -d); trap 'rm -rf "$tmpdir"' EXIT

gam print resources allfields > "$tmpdir/resources.csv"
gam print orgs allfields       > "$tmpdir/ous.csv"
gam print groups allfields     > "$tmpdir/groups.csv"

curl -sSf -X POST \
  -H "Authorization: Bearer $RENTAL_TOKEN" \
  -H "X-Source-Service: gam-runner" \
  -F "resources=@$tmpdir/resources.csv" \
  -F "ous=@$tmpdir/ous.csv" \
  -F "groups=@$tmpdir/groups.csv" \
  "$RENTAL_API/api/gam/reconcile" \
  -o "$tmpdir/report.json"

jq . "$tmpdir/report.json"
