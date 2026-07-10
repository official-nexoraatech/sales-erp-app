# PG-024 — Backup & Disaster Recovery Strategy — Completion Report

**Date:** 2026-07-10
**Status:** Scripting/documentation deliverables complete. **One acceptance criterion deliberately not claimed** — see §Deployment Checklist.

## Summary

Hardened the already-proven backup baseline (`backup.sh`, docker-compose `backup`
service, k8s `backup-cronjob.yaml`, `dr-drill-report.md`'s 2026-07-01 drill —
24m17s RTO / 2m16s RPO) rather than rebuilding it, per the gap-prompt's own
correction that a real DR capability already existed. Added: the runbook that
`dr-drill-report.md` referenced but never had, an encrypted offsite backup
copy, Prometheus Pushgateway metrics + a `BackupStale`/`BackupDurationHigh`
alert pair, a quarterly re-drill reminder scheduler job, and a written policy
document that explicitly accepts (does not attempt to solve) the multi-tenant
all-or-nothing restore constraint.

Docker Desktop was not running in this session (confirmed via `docker version`),
so — consistent with the gap-prompt's own "Known Constraints" section — **the
actual re-drill against the new offsite+encrypted path was not executed**.
Nothing in this report claims otherwise.

## Files Changed

- `infrastructure/docker/backup/backup.sh` — added §4 encrypted offsite copy
  (`age` + `mc cp` to a second S3-compatible bucket) and §5 metrics emission;
  the original `pg_dump`/`redis-cli SAVE`/`mc mirror` sequence is untouched.
- `infrastructure/docker/backup/push-metrics.sh` — **new**; metrics-push logic
  split out of `backup.sh` so it's independently testable (see Tests below).
- `infrastructure/docker/backup/Dockerfile` — added `age`, `tar` packages;
  copies `push-metrics.sh`.
- `docker-compose.yml` — new `pushgateway` service; `backup` service gets 6 new
  env vars (all empty/optional by default — offsite copy and encryption are
  skipped, not failed, when unset) and a `depends_on: pushgateway`.
- `infrastructure/docker/prometheus/prometheus.yml` — new `pushgateway` scrape
  job (`honor_labels: true`).
- `infrastructure/docker/prometheus/alert-rules.yml` — new `erp.backup` group:
  `BackupStale` (>25h since last success, pages), `BackupDurationHigh` (>30min
  single run, warns).
- `infrastructure/k8s/backup-cronjob.yaml` — same 6 env vars, sourced from a
  new `erp-backup-offsite-secret` Secret (all keys `optional: true` — the
  CronJob still runs local-only backups if the Secret doesn't exist yet).
- `infrastructure/k8s/pushgateway.yaml` — **new**; Deployment + Service,
  Kubernetes equivalent of the docker-compose `pushgateway` service.
- `infrastructure/k8s/kustomization.yaml` — added `pushgateway.yaml` **and**
  `backup-cronjob.yaml` to the `resources:` list. **Pre-existing gap found and
  fixed in passing:** `backup-cronjob.yaml` was never in this list before —
  the entire k8s backup path was unreachable by `kubectl apply -k`, silently,
  since the CronJob was written. Flagging this explicitly since it's outside
  what PG-024 itself asked for but directly blocks the acceptance criteria
  that depend on the k8s path actually being deployed.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new
  `platform.dr-drill-reminder` job (cron `0 9 1 1,4,7,10 *`), registered
  identically to the other 45 `registry.register(...)` calls in this file; not
  `manualOnly`, so it's auto-scheduled by `main.ts`'s existing startup loop.
  Calls `notification-service`'s `POST /notifications/send-internal`-family
  endpoint (`send-raw-internal`, pre-rendered body, no template lookup) —
  skips (logs a warning, does not throw) if `DR_DRILL_OWNER_EMAIL` is unset.
- `.env.example` — new `OFFSITE_MINIO_*`, `BACKUP_ENCRYPTION_PUBLIC_KEY`,
  `PUSHGATEWAY_URL`, `DR_DRILL_REMINDER_TENANT_ID`, `DR_DRILL_OWNER_EMAIL`.
- `infrastructure/runbooks/dr-runbook.md` — **new**; the file
  `dr-drill-report.md` referenced since 2026-07-01 but which never existed.
- `ERP-PLANNING/phase-completions/PG-024_DR_POLICY.md` — **new**; RPO/RTO
  commitments, Kafka/Elasticsearch exclusion rationale, and the multi-tenant
  restore constraint, stated explicitly per the gap-prompt's requirement.

## Design notes / judgment calls

- **Notification recipient requires a `tenantId`.** `notification-service`'s
  send endpoints all require a `tenantId` (templates/log entries are
  tenant-owned) even for an internal-ops-only reminder with no natural tenant.
  Added `DR_DRILL_REMINDER_TENANT_ID` (defaults to `1`) to pick which tenant's
  channel config the reminder routes through — this is a real architectural
  friction point (notification-service has no tenant-less/platform-level send
  path), not something PG-024 should fix; noted here for visibility.
- **Pushgateway over node-exporter textfile collector.** The gap-prompt
  offered either. `prometheus.yml` scrapes `node-exporter` at
  `host.docker.internal:9100`, meaning node-exporter runs on the host directly
  and is **not** managed by this repo's docker-compose/k8s — there's no
  existing textfile-collector directory convention to hook into reliably, and
  the docker-compose/k8s paths would need two different, ad hoc mechanisms.
  Pushgateway gives one consistent push target for both.
- **`age` over `gpg`** for encryption — smaller, scriptable, single static
  recipient-key model fits a cron job better than gpg's keyring semantics.

## Tests Added + Results

- `infrastructure/docker/backup/__tests__/push-metrics.test.mjs` — Node's
  built-in test runner (`node --test`), no new dependency. Mocks a backup
  completion event (fake duration/size/offsite-success) against a local mock
  Pushgateway HTTP server and asserts the pushed payload's format and that
  `erp_backup_last_success_timestamp` is fresh (within the test's own
  execution window); a second case confirms the script is a clean no-op when
  `PUSHGATEWAY_URL` is unset. **2/2 passing.**
  - Caught and fixed a real bug during authoring, not just a Windows quirk:
    the first draft used `spawnSync`, which blocks Node's entire event loop —
    since the mock Pushgateway is an in-process HTTP server on that same event
    loop, `spawnSync` deadlocked the test against its own mock server (the
    server could never get a turn to accept/process the request). Fixed by
    switching to async `spawn`. This would have deadlocked in CI too, not just
    locally — worth knowing if this pattern (in-process mock server +
    synchronous child-process call) shows up elsewhere in this codebase.
  - **Not yet wired into CI.** `.github/workflows/ci.yml` had unrelated
    uncommitted changes from a concurrent session at the time of this work
    (see `[[concurrent_sessions_on_same_repo]]`) — deliberately not touched to
    avoid clobbering that work. Whoever next edits `ci.yml` should add a step
    running `node --test infrastructure/docker/backup/__tests__/*.test.mjs`.
- `apps/scheduler-service` — full existing suite re-run after adding the new
  job: **45/45 passing**, `tsc --noEmit` clean. `eslint src/` shows the same
  pre-existing `no-undef` (`process`, `fetch`) errors the rest of this file
  already has on every other job (missing ESLint globals — see
  `[[preexisting_lint_debt]]`); the new job follows the exact same style as
  its 45 neighbors, no new error category introduced.
- `docker-compose.yml` validated with `docker compose config -q` (no live
  Docker daemon was available to actually start the stack — Docker Desktop
  was down all session).
- All touched/new k8s YAML (`backup-cronjob.yaml`, `pushgateway.yaml`,
  `kustomization.yaml`) and Prometheus config (`prometheus.yml`,
  `alert-rules.yml`) parsed successfully with `js-yaml` (no `kubectl`/live
  cluster available to `apply --dry-run`).
- `bash -n` clean on `backup.sh` and `push-metrics.sh`.

## Deployment Checklist

- [ ] **Provision an offsite S3-compatible bucket** (separate provider/region
      from the primary MinIO) and set `OFFSITE_MINIO_ENDPOINT` /
      `OFFSITE_MINIO_ACCESS_KEY` / `OFFSITE_MINIO_SECRET_KEY` /
      `OFFSITE_MINIO_BUCKET` in the real environment (`.env` locally, the new
      `erp-backup-offsite-secret` k8s Secret in cluster). Until this is done,
      backups remain local-only — `backup.sh` skips the offsite step silently
      rather than failing, by design, but that means DR posture is unchanged
      from before PG-024 until this step happens.
- [ ] **Generate the `age` keypair**: `age-keygen -o dr-backup-key.txt`. Put
      the **public** key in `BACKUP_ENCRYPTION_PUBLIC_KEY`. Store the
      **private** key file outside this repo per the manual key-custody
      process (Vault once PG-004 lands) — losing it makes every offsite backup
      permanently unreadable; committing it anywhere defeats the entire point
      of encrypting the backups.
- [ ] **Deploy the `pushgateway` Deployment/Service** to the cluster
      (`kubectl apply -k infrastructure/k8s/` now picks it up — see the
      `kustomization.yaml` fix above) and confirm Prometheus's `pushgateway`
      scrape job (`prometheus.yml`) is live in the deployed Prometheus config,
      not just this repo's copy.
- [ ] **Confirm `BackupStale`/`BackupDurationHigh` reach a real channel** —
      they depend on PG-023's Alertmanager routing (`pagerduty` /
      `slack-infra-alerts`), which is live per this repo's config, but verify
      the actual PagerDuty/Slack webhooks in `.env` are the production ones,
      not placeholders.
- [ ] **Set `DR_DRILL_OWNER_EMAIL`** to a real, monitored address — the
      `platform.dr-drill-reminder` job silently no-ops (logs a warning) if
      this is unset, which would silently reintroduce the exact "recommended
      but nothing enforces it" gap this package exists to close.
- [ ] **Manually trigger `platform.dr-drill-reminder`** once after deploying
      scheduler-service (`POST /jobs/platform.dr-drill-reminder/trigger` — see
      `dr-runbook.md`) to confirm it actually reaches the owner's inbox before
      relying on the quarterly cron.
- [ ] **Re-run the DR drill end-to-end against the new offsite+encrypted
      path** and record it as a new dated report next to
      `dr-drill-report.md`, following `dr-runbook.md`. This is the one
      PG-024 acceptance criterion **not** satisfied by this session's work —
      it requires a live Docker/cluster environment, which was unavailable
      here (Docker Desktop down). Until this runs, treat the offsite/
      encrypted path as *implemented but unverified*, not drill-proven — see
      `PG-024_DR_POLICY.md` §8.

## Phases Unblocked

None directly — this is an infrastructure-hardening package with no other
gap-prompt depending on it (`Depends on: none`, `Blocks: none` per the
originating brief). PG-023 (alerting) and PG-026 (scheduler jobs) are named
integration points, both already landed in this codebase.
