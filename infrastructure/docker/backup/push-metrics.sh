#!/bin/bash
# Emits erp_backup_* Prometheus metrics to Pushgateway after a backup run.
# Split out from backup.sh so this piece can be exercised in CI against a
# mocked backup-completion event — see __tests__/push-metrics.test.mjs —
# without needing real Postgres/Redis/MinIO.
set -euo pipefail

DURATION_SECONDS="${1:?duration seconds required}"
SIZE_BYTES="${2:?size bytes required}"
OFFSITE_SUCCESS="${3:-0}"
PUSHGATEWAY_URL="${PUSHGATEWAY_URL:-}"

if [ -z "$PUSHGATEWAY_URL" ]; then
  echo "[backup] PUSHGATEWAY_URL not set — skipping metrics emission"
  exit 0
fi

curl --silent --show-error --data-binary @- "${PUSHGATEWAY_URL}/metrics/job/erp_backup" <<METRICS
# TYPE erp_backup_last_success_timestamp gauge
erp_backup_last_success_timestamp $(date +%s)
# TYPE erp_backup_duration_seconds gauge
erp_backup_duration_seconds ${DURATION_SECONDS}
# TYPE erp_backup_size_bytes gauge
erp_backup_size_bytes ${SIZE_BYTES}
# TYPE erp_backup_offsite_success gauge
erp_backup_offsite_success ${OFFSITE_SUCCESS}
METRICS
