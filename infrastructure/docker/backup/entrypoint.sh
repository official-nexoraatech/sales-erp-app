#!/bin/bash
# Runs a backup immediately (so a fresh stack always has at least one restore
# point), then repeats every BACKUP_INTERVAL_SECONDS. A plain sleep loop is used
# instead of a cron daemon — dcron/busybox crond's `setpgid` call fails under
# Docker Desktop's container runtime here, crash-looping the container.
set -euo pipefail

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

while true; do
  /app/backup.sh || echo "[backup] run failed — will retry in ${INTERVAL}s"
  sleep "$INTERVAL"
done
