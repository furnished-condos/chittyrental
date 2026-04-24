#!/usr/bin/env bash
# Full pull + apply: orchestrates the bootstrap + provision scripts.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

"$here/bootstrap-ous.sh"          "$@"
"$here/bootstrap-groups.sh"       "$@"
"$here/provision-buildings.sh"    "$@"
"$here/provision-resources.sh"    "$@"
"$here/provision-drives.sh"       "$@"

echo "Sync complete."
