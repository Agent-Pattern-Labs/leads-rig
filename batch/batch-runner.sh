#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PUBLIC_LEADS_PROJECT:-${LEAD_HARNESS_PROJECT:-$(cd "$SCRIPT_DIR/.." && pwd)}}"

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  SOURCE_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$SOURCE_DIR/$SOURCE"
done
HARNESS_BATCH_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
HARNESS_DIR="$(cd "$HARNESS_BATCH_DIR/.." && pwd)"

export PUBLIC_LEADS_PROJECT="$PROJECT_DIR"
export LEAD_HARNESS_PROJECT="$PROJECT_DIR"
exec node "$HARNESS_DIR/scripts/batch-orchestrator.mjs" "$@"
