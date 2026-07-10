#!/bin/bash
# Runs the DR-drill-proven backup steps (see dr-drill-report.md Step 1):
# 1. PostgreSQL custom-format dump via pg_dump
# 2. Redis RDB snapshot via SAVE
# 3. MinIO object store mirror
# 4. (PG-024) Encrypted offsite copy — age-encrypts the local backup and mirrors
#    it to a second, geographically-separate S3-compatible bucket so a full
#    site/cluster loss doesn't also destroy the only backup copy.
# 5. (PG-024) Success/duration/size metrics pushed to Prometheus Pushgateway —
#    a batch job can't be scraped, so it pushes instead (see BackupStale alert
#    in infrastructure/docker/prometheus/alert-rules.yml).
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
START_EPOCH=$(date +%s)
BACKUP_DIR="/backups/${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "[backup] ${TIMESTAMP} — starting"

# ─── 1. PostgreSQL ──────────────────────────────────────────────────────────
echo "[backup] pg_dump ${PGDATABASE}@${PGHOST}:${PGPORT}"
PGPASSWORD="$PGPASSWORD" pg_dump \
  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
  -Fc -f "${BACKUP_DIR}/postgres_${TIMESTAMP}.dump"

# ─── 2. Redis ───────────────────────────────────────────────────────────────
echo "[backup] redis-cli SAVE on ${REDIS_HOST}:${REDIS_PORT}"
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" SAVE
cp /redis-data/dump.rdb "${BACKUP_DIR}/redis_${TIMESTAMP}.rdb"

# ─── 3. MinIO ───────────────────────────────────────────────────────────────
echo "[backup] mc mirror ${MINIO_BUCKET}"
mc alias set backupsrc "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
mc mirror --quiet "backupsrc/${MINIO_BUCKET}" "${BACKUP_DIR}/minio_${MINIO_BUCKET}/" || \
  echo "[backup] MinIO bucket empty or unreachable — continuing (non-fatal)"

# ─── Retention: keep last 7 backups ─────────────────────────────────────────
cd /backups
ls -1dt */ 2>/dev/null | tail -n +8 | xargs -r rm -rf
cd /

# ─── 4. Encrypted offsite copy (PG-024) ─────────────────────────────────────
# Both OFFSITE_MINIO_ENDPOINT and BACKUP_ENCRYPTION_PUBLIC_KEY (an `age`
# recipient public key) must be set — the decryption private key is never
# read by this script; it lives outside this repo (Vault post-PG-004, or a
# documented manual key-custody process until then — see dr-runbook.md).
OFFSITE_STATUS=0
if [ -n "${OFFSITE_MINIO_ENDPOINT:-}" ] && [ -n "${BACKUP_ENCRYPTION_PUBLIC_KEY:-}" ]; then
  echo "[backup] encrypting archive for offsite copy"
  ARCHIVE="/tmp/erp_backup_${TIMESTAMP}.tar"
  tar -cf "$ARCHIVE" -C /backups "${TIMESTAMP}"
  age -r "$BACKUP_ENCRYPTION_PUBLIC_KEY" -o "${ARCHIVE}.age" "$ARCHIVE"
  rm -f "$ARCHIVE"

  echo "[backup] pushing encrypted archive to offsite destination"
  mc alias set backupdst "$OFFSITE_MINIO_ENDPOINT" "$OFFSITE_MINIO_ACCESS_KEY" "$OFFSITE_MINIO_SECRET_KEY" >/dev/null
  mc cp --quiet "${ARCHIVE}.age" "backupdst/${OFFSITE_MINIO_BUCKET}/erp_backup_${TIMESTAMP}.tar.age"
  rm -f "${ARCHIVE}.age"
  OFFSITE_STATUS=1
  echo "[backup] offsite copy complete"
else
  echo "[backup] OFFSITE_MINIO_ENDPOINT/BACKUP_ENCRYPTION_PUBLIC_KEY not set — skipping offsite copy (local-only backup)"
fi

# ─── 5. Metrics (PG-024) ─────────────────────────────────────────────────────
DURATION=$(( $(date +%s) - START_EPOCH ))
SIZE_BYTES=$(du -sb "$BACKUP_DIR" | cut -f1)
echo "[backup] pushing metrics to Pushgateway (duration=${DURATION}s size=${SIZE_BYTES}b offsite=${OFFSITE_STATUS})"
/app/push-metrics.sh "$DURATION" "$SIZE_BYTES" "$OFFSITE_STATUS" || echo "[backup] metrics push failed — non-fatal"

echo "[backup] ${TIMESTAMP} — complete: ${BACKUP_DIR} (${DURATION}s, ${SIZE_BYTES} bytes)"
