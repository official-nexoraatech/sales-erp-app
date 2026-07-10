# Disaster Recovery Runbook

> Referenced by `ERP-PLANNING/phase-completions/dr-drill-report.md` (recommendation #5)
> since 2026-07-01 but never written until PG-024. This is the actual procedure —
> follow it verbatim for both the quarterly drill and a real incident.

**Owner:** whoever `DR_DRILL_OWNER_EMAIL` (see `.env.example`) points at.
**Cadence:** quarterly, enforced by the `platform.dr-drill-reminder` scheduler job
(1st of Jan/Apr/Jul/Oct, 09:00 — see `apps/scheduler-service/src/jobs/system-jobs.ts`).
**Companion doc:** `ERP-PLANNING/phase-completions/PG-024_DR_POLICY.md` — read that
first for *why* these targets and constraints exist; this file is only the *how*.

---

## 0. Before you start

- This restores into an **isolated environment** — a separate docker-compose
  project / namespace, never the primary. Never point a restore at production
  unless this genuinely is a production incident.
- A restore is **all-tenants-together** — see PG-024_DR_POLICY.md §Multi-Tenant
  Restore Constraint. There is no way to restore a single tenant in isolation.
- Have these on hand: the latest backup timestamp directory (`/backups/<ts>/` or
  the offsite bucket equivalent), the `age` decryption private key (Vault, or
  wherever your manual key-custody process keeps it — never in this repo), a
  test user's credentials for the login smoke test.

---

## 1. Locate the backup to restore

**Local backup (fastest — try this first):**
```bash
docker exec erp-backup ls -1dt /backups/*/ | head -5
```

**Offsite backup (use if local storage/cluster is also lost):**
```bash
mc alias set offsitesrc "$OFFSITE_MINIO_ENDPOINT" "$OFFSITE_MINIO_ACCESS_KEY" "$OFFSITE_MINIO_SECRET_KEY"
mc ls "offsitesrc/${OFFSITE_MINIO_BUCKET}/" | sort | tail -5
mc cp "offsitesrc/${OFFSITE_MINIO_BUCKET}/erp_backup_<TIMESTAMP>.tar.age" ./
age -d -i /path/to/dr-backup-key.txt -o erp_backup_<TIMESTAMP>.tar erp_backup_<TIMESTAMP>.tar.age
tar -xf erp_backup_<TIMESTAMP>.tar
```
This decrypts to the same `<TIMESTAMP>/postgres_*.dump`, `redis_*.rdb`,
`minio_<bucket>/` layout the local path produces — steps 2+ are identical
either way.

---

## 2. Spin up an isolated restore stack

```bash
mkdir dr-test && cd dr-test
docker compose -f ../docker-compose.yml -p erp-dr up -d \
  erp-postgres-primary erp-redis-1 erp-kafka erp-zookeeper erp-minio
```

## 3. Restore each store

```bash
# PostgreSQL
docker exec erp-dr-postgres-primary psql -U erp -d erp -c 'SELECT 1'  # confirm empty DB is up
docker exec -i erp-dr-postgres-primary pg_restore \
  -U erp -d erp -Fc --clean --if-exists < <TIMESTAMP>/postgres_<TIMESTAMP>.dump

# Redis
docker cp <TIMESTAMP>/redis_<TIMESTAMP>.rdb erp-dr-redis-1:/data/dump.rdb
docker restart erp-dr-redis-1

# MinIO
mc alias set dr-minio http://localhost:<dr-minio-port> minioadmin minioadmin123
mc mirror <TIMESTAMP>/minio_erp-local/ dr-minio/erp-documents
```

Kafka and Elasticsearch are **not** restored from this backup — see
PG-024_DR_POLICY.md §Kafka and §Elasticsearch for why, and what each one's own
rebuild path is (`search.full-reindex` for Elasticsearch; Kafka's own topics
simply start empty and downstream consumers catch up from whatever the outbox
relay produces going forward).

## 4. Start services against the restored stack

Point every service's `DATABASE_URL` / `REDIS_URL` at the `erp-dr-*` containers
and start them (docker-compose profile or manual `pnpm --filter <service> dev`
with overridden env). Record the time you started this step — it's the anchor
for the RTO measurement in step 6.

## 5. Validation checklist

Reuse the exact checklist `dr-drill-report.md` used — don't invent a new one,
this is the point of comparison across drills:

- [ ] All services report healthy: `curl -s localhost:<port>/health | jq .status` for each of the 11 (see prometheus.yml scrape list for the current port map).
- [ ] Login with a test user succeeds: `POST /auth/login`.
- [ ] Customer count in the restored DB matches the pre-backup count for a known tenant.
- [ ] A known invoice from before the backup is accessible via the API.
- [ ] A brand-new invoice can be created successfully.
- [ ] Trial balance report balances (`totalDebits == totalCredits`) for a known branch.

## 6. Record RTO / RPO

- **RTO** = time from "declared failure" (or, for a drill, the moment you started step 2) to all 6 validation checklist items passing.
- **RPO** = timestamp of the last committed transaction captured in the backup, minus the backup's own trigger timestamp — check the last invoice/outbox event inside the restored DB against what you know was live at backup time.
- Targets (see PG-024_DR_POLICY.md): **RTO < 30 min, RPO < 15 min** (Standard tier).
- Write up a new dated report copying `ERP-PLANNING/phase-completions/dr-drill-report.md`'s format — same sections, same tables — as `dr-drill-report-<YYYY-MM-DD>.md` in the same directory, so results are directly comparable across quarters.

## 7. Tear down

```bash
docker compose -f ../docker-compose.yml -p erp-dr down -v
```
Never leave a `dr-test`/`erp-dr` stack running — it holds a decrypted copy of
every tenant's financial data outside the normal access boundary.

---

## Backup monitoring (for troubleshooting a `BackupStale` alert, not the drill)

If `BackupStale` fires (`erp_backup_last_success_timestamp` stale by >25h):

1. Check the backup container/CronJob's own logs first — `backup.sh` logs
   every step with a `[backup]` prefix:
   ```bash
   docker logs erp-backup --tail 100                              # docker-compose
   kubectl logs -n erp-system -l app=erp-backup --tail=100         # k8s
   ```
2. Common causes: `pg_dump` auth failure (credential rotated without updating
   the backup service's env/Secret), MinIO/offsite endpoint unreachable,
   Pushgateway itself down (metrics never arrive even if the backup itself
   succeeded — check step 3 below to disambiguate).
3. Confirm whether the backup actually ran but metrics didn't reach
   Pushgateway (vs. the backup itself failing) by checking for a fresh
   `/backups/<timestamp>/` directory even though the alert is firing — if a
   fresh backup exists, the fault is in the Pushgateway push/scrape path, not
   backup correctness, and is lower urgency (the backup itself is fine).

## Manually triggering the quarterly reminder (to verify the scheduler job)

```bash
curl -X POST localhost:3016/jobs/platform.dr-drill-reminder/trigger \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
(Uses the existing `JobRegistry.triggerManual` path via scheduler-service's
`POST /jobs/:name/trigger` route — confirms the job fires and
`notification-service` accepts it, without waiting for the actual quarterly
cron tick.)
