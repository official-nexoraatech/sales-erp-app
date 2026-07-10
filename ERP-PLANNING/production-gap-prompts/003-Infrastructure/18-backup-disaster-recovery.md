# [PG-024] Backup & Disaster Recovery Strategy

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Infrastructure
**Priority:** High
**Complexity:** L — most of the mechanics (backup automation, a proven restore drill) already exist; the remaining work is formalizing an ongoing policy, closing monitoring/encryption/offsite gaps, and explicitly documenting the multi-tenant restore constraint that no prior document addresses.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `infrastructure/docker/backup/`, `infrastructure/k8s/backup-cronjob.yaml`, `docker-compose.yml`, Postgres/Redis/MinIO/Kafka/Elasticsearch

---

## Overview

- **Business objective:** If the primary Postgres instance is lost (disk failure, bad migration, accidental `DROP`, region outage), the business needs a known, tested, bounded-time path back to a working system — every invoice, ledger entry, and customer record lives in that one shared database. Without a tested plan, "we'll figure it out" is not an acceptable answer for a system handling GST-compliant financial records.
- **Current implementation — IMPORTANT CORRECTION to this package's originating brief:** The brief assumed "no backup/DR strategy is documented anywhere in ERP-PLANNING/." That is **false** — verified directly:
  - `ERP-PLANNING/phase-completions/dr-drill-report.md` (dated 2026-07-01) documents a full, executed DR drill: backup (`pg_dump -Fc` + Redis `SAVE` + `mc mirror` for MinIO) → restore into an isolated Docker Compose stack → an 11-service health-check + login + customer-count + invoice-accessibility + new-invoice-creation + trial-balance-reconciliation validation suite → measured **RTO of 24 min 17 sec** (target: <30 min, PASS) and **RPO of 2 min 16 sec** (target: <15 min, PASS, far exceeds target).
  - `docker-compose.yml` already has a real `backup` service (comment: "Automated Backup (M13)") that builds from `infrastructure/docker/backup/` and runs daily (`BACKUP_INTERVAL_SECONDS: "86400"`).
  - `infrastructure/docker/backup/backup.sh` is a real, working script (not a stub) — it runs the exact three-step sequence the drill report validated (`pg_dump -Fc`, `redis-cli SAVE` + copy the RDB, `mc mirror` for MinIO), writes timestamped backups to `/backups/<timestamp>/`, and prunes to the last 7 backups.
  - `infrastructure/k8s/backup-cronjob.yaml` is a real Kubernetes `CronJob` (daily at 02:00, `concurrencyPolicy: Forbid`, `backoffLimit: 2`, a 20Gi `PersistentVolumeClaim` for backup storage) — the production/Kubernetes equivalent of the same script, explicitly commented as such.
  This is a **materially more mature starting point** than "no strategy exists" — this package is about *operationalizing and hardening an already-proven capability*, not building one from scratch.
- **Current architecture:** Backup: `postgres-primary` (pg_dump, custom format, daily) + `redis-1` (RDB snapshot, daily) + MinIO (`mc mirror`, daily) → local `/backups` volume (docker-compose) or a PVC (k8s). No offsite/cross-region copy exists in either path — both write to storage co-located with the primary. Kafka and Elasticsearch are explicitly not backed up by this mechanism.
- **Current limitations (verified, concrete, and genuinely still open despite the above):**
  1. **No recurring drill cadence is enforced.** `dr-drill-report.md`'s own recommendation #3 says "Test quarterly... first Monday of Q1, Q2, Q3, Q4" and recommendation #5 references a "Full step-by-step procedure documented in `infrastructure/runbooks/dr-runbook.md`" — **that runbook file does not exist** (verified via `Glob` — `infrastructure/runbooks/` has no files at all). The quarterly cadence has no calendar reminder, no scheduler job, no CI gate — it is a recommendation with nothing enforcing it, and (as of this writing) has not been repeated since the 2026-07-01 drill.
  2. **No backup-success monitoring or alerting.** `backup.sh` logs to stdout only; if the CronJob or docker-compose `backup` container silently fails for a week, nothing would notice until an actual restore is needed. There is no `erp_backup_last_success_timestamp` metric, no alert rule for "backup hasn't succeeded in >26 hours" (this is a natural pairing with PG-023's Alertmanager work, once that exists).
  3. **No offsite / geographically-separate backup copy.** Both the docker-compose and Kubernetes backup paths write to storage in the same cluster/host as the primary — a full site/region loss (not just a disk failure) would take the backups down with the primary. `backup.sh`'s MinIO mirror target is `erp-local`/`erp-production` bucket on the *same* MinIO instance being backed up from, which is itself a single point of failure for the object-storage tier's own backups.
  4. **No encryption at rest for backup files**, and `backup.sh` relies on `PGPASSWORD`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` as plain env vars (consistent with the rest of this codebase's pre-Vault-integration state — see PG-004 — but worth flagging here specifically because backup files are a concentrated, portable copy of all tenants' financial data, a higher-value target than a live DB connection).
  5. **The multi-tenant restore constraint is not documented anywhere.** This codebase uses a single shared Postgres schema with `tenant_id`-column isolation (no per-tenant database, no RLS) — a `pg_restore` necessarily restores *all* tenants together. If one tenant needs point-in-time recovery (e.g., they accidentally deleted a quarter of invoices) but other tenants must stay on current data, **there is no mechanism to restore one tenant without restoring/rolling back every tenant sharing that Postgres instance.** Neither `dr-drill-report.md` nor any other document states this as a known, accepted constraint. This package's job is to **document and accept** this constraint (per the task's own framing — this is an architectural reality of the shared-schema model, not something this DR package should attempt to solve by re-architecting tenant isolation).
  6. **Kafka is not backed up, and its replayability-from-outbox has not been explicitly verified or documented.** The transactional outbox pattern (writes to `outbox_events` in the same DB transaction as the business change, relayed to Kafka by a separate worker) means Kafka's own data is, in principle, re-derivable from Postgres for anything not yet consumed — but *already-consumed-and-then-lost* Kafka messages (e.g., a downstream projection or `search-service`'s Elasticsearch index that was built from a Kafka message that no longer exists because Kafka's own log was lost) are not simply "replay from outbox," since the outbox table itself gets cleaned up after successful relay (see `platform.outbox-cleanup` scheduler job, PG-026) — meaning outbox is not a permanent replay log, only a relay staging buffer. This nuance needs to be stated explicitly rather than hand-waved as "Kafka is always replayable."
  7. **Elasticsearch has no backup mechanism at all** — correctly deprioritized per this package's own brief (rebuildable via `search.full-reindex`, the weekly scheduler job — see PG-026), but this should be an explicit, written decision in the DR doc, not an implicit omission.

## Existing Code Analysis

- **What already exists and should be reused:** `infrastructure/docker/backup/backup.sh`, `Dockerfile`, `entrypoint.sh` — the backup mechanics are correct and drill-proven; do not rewrite the pg_dump/Redis/MinIO sequence. `infrastructure/k8s/backup-cronjob.yaml` — reuse as the Kubernetes path, extend rather than replace. `dr-drill-report.md`'s validation suite (health checks, login, customer-count match, invoice accessibility, trial-balance reconciliation) — reuse this exact checklist as the basis for the recurring drill runbook this package writes.
- **What should never be modified:** The proven backup script's core sequence (`pg_dump -Fc` → Redis `SAVE` → `mc mirror`) — it is already validated against a real restore. Changes here should be additive (encryption, offsite copy, monitoring) not a rewrite of working mechanics.
- **Prior related work:** `ERP-PLANNING/phase-completions/dr-drill-report.md` is the single most important prior artifact for this package — read it in full before starting, it is effectively this package's acceptance-test template already executed once.

## Architecture

- **RPO/RTO targets (formalize what the drill already measured, don't re-derive from zero):** Adopt the drill's proven numbers as the documented, committed targets — RPO ≤ 15 minutes (drill achieved 2m16s), RTO ≤ 30 minutes (drill achieved 24m17s) for a **Standard tier** (the drill's own terminology, implying tiering may already be a considered concept — if no other tier is defined elsewhere, treat "Standard" as the only tier for now and note that a future Enterprise-tier SLA would need a shorter target plus continuous WAL archiving, per the drill's own recommendation #1).
- **Backup schedule per store (extend existing, don't replace):**
  - Postgres: daily full `pg_dump -Fc` (existing) — this package should evaluate adding **WAL archiving** (`archive_mode = on` + `archive_command` shipping WAL segments to MinIO/S3 continuously) per the drill's own recommendation #1, which would cut RPO from "up to 24h stale" (worst case between daily dumps) to "seconds," a meaningful upgrade the drill itself flagged as the natural next step.
  - Redis: daily RDB snapshot (existing) — acceptable as-is since Redis here holds cache/session/lock state, not source-of-truth financial data; document this explicitly as a deliberate lower-rigor tier.
  - MinIO: daily `mc mirror` (existing) — add a **second mirror target on separate physical/cloud storage** (see Offsite below) rather than only ever mirroring within the same MinIO instance.
  - Kafka: no backup (existing, by design) — document explicitly *why* (outbox is the durability boundary pre-relay; post-relay, downstream consumers each own their own replay/rebuild story — e.g. `search.full-reindex` for Elasticsearch) rather than leaving this as a silent gap.
  - Elasticsearch: no backup (existing, by design) — document explicitly that `search.full-reindex` (weekly scheduler job, see PG-026) is the accepted rebuild path, with an explicit RTO-for-search-specifically (likely worse than 30 min for a full reindex on a large tenant base — state this rather than implying the same 30-min RTO applies uniformly to every subsystem).
- **Offsite copy:** Add a second backup destination outside the primary cluster/region — at minimum, a separate cloud object-storage bucket (S3/Backblaze/other MinIO instance in a different failure domain) that `backup.sh` pushes to *after* the local backup succeeds, so a total-site-loss scenario doesn't also destroy the only backup copy.
- **Backup monitoring:** Emit a Prometheus metric (`erp_backup_last_success_timestamp` gauge, `erp_backup_duration_seconds`, `erp_backup_size_bytes`) from `backup.sh`/`entrypoint.sh` via a Prometheus Pushgateway (since this is a batch/cron job, not a long-running scrape target) or a simple textfile-collector pattern for `node-exporter`. Pair with a new Alertmanager rule (coordinate with PG-023) — `BackupStale` firing if `time() - erp_backup_last_success_timestamp > 90000` (25h).
- **Recurring drill cadence:** Write `infrastructure/runbooks/dr-runbook.md` (the file `dr-drill-report.md` already references but which doesn't exist) as the repeatable step-by-step procedure, and register a new scheduler job (reusing the existing `JobRegistry`/BullMQ pattern in `apps/scheduler-service`, consistent with PG-026's approach) — not to *run* the drill automatically (a full restore drill deliberately touches an isolated environment and needs human validation of business-data correctness), but to **remind/ticket** on the first Monday of each quarter, closing the "recommended but nothing enforces it" gap.

## Database Changes

Not applicable — no schema change to any of the 4 backend databases. (If the backup-monitoring metric needs a durable record beyond Prometheus's own retention — e.g. a `backup_history` audit table for compliance — that would be a small additive table, but is not required to satisfy this package's core acceptance criteria; note it as an optional enhancement, not a required migration.)

## Backend

- Extend `infrastructure/docker/backup/backup.sh` (and the k8s CronJob's equivalent container) to: (a) push a second copy to an offsite destination after the existing local backup succeeds; (b) emit success/failure/duration/size metrics; (c) encrypt the backup archive at rest (e.g., `gpg --encrypt` or `age` before writing to the offsite destination, with the decryption key managed outside this repo — Vault once PG-004 lands, or a documented manual key-custody process in the interim).
- New scheduler job (in `apps/scheduler-service/src/jobs/system-jobs.ts`, following the exact `registry.register(...)` pattern already used for the other 44 jobs there — see PG-026): `platform.dr-drill-reminder`, cron `0 9 1 1,4,7,10 *` (09:00 on the 1st of Jan/Apr/Jul/Oct — approximates "first Monday of the quarter" closely enough, or compute the actual first Monday in the handler if exact-Monday matters), posting a reminder (via `notification-service`, reusing its existing channel — this is an internal-ops reminder, appropriate for that service, unlike PG-023's infra alerting which deliberately avoids it) to whoever owns DR ownership.
- No changes to `packages/db-client` or any service's core domain logic — this package is infra-script and scheduler-job scoped only.

## Frontend

Not applicable — backend/infra-only gap.

## API Contract

Not applicable — no new REST endpoints. (If backup status should be visible in an admin UI, that would be a small, separate follow-up reusing the existing admin dashboard pattern — not required for this package's acceptance criteria.)

## Multi-Tenant Considerations

- **This is the section where this package must explicitly accept, not solve, the core architectural constraint:** because all tenants share one Postgres instance/schema with `tenant_id`-column isolation (no RLS, no per-tenant database), **a restore operation is necessarily all-tenants-or-nothing.** There is no supported path to restore Tenant A's data to an earlier point in time while leaving Tenant B, C, D... on current data, short of a manual, error-prone `pg_restore` into a scratch database followed by a hand-written `INSERT ... SELECT ... WHERE tenant_id = X` reconciliation script written ad hoc at incident time — which itself risks violating referential integrity across tables if done carelessly (e.g., restoring a customer row without its associated invoices, or vice versa). Document this constraint plainly in whatever DR policy doc this package produces, framed as: "single-tenant point-in-time recovery is not a supported DR capability today; a full-instance restore affects all tenants; a genuinely isolated per-tenant recovery would require a per-tenant-schema or per-tenant-database architecture change, which is out of scope for this package and would be a significant, separate architectural decision."
- Backup files themselves contain all tenants' data commingled (a single `pg_dump` covers the whole shared database) — this raises the stakes on the encryption-at-rest and access-control gaps noted above, since a single leaked backup file is a full multi-tenant data breach, not a single customer's exposure.

## Integration

- **Postgres primary** — the core data store this package protects.
- **Redis, MinIO** — secondary stores already covered by the existing backup script; this package hardens (offsite, encryption, monitoring) rather than re-architects their backup path.
- **PG-023 (Alerting)** — the new `erp_backup_last_success_timestamp` metric and `BackupStale` alert rule depend on PG-023's Alertmanager existing to actually notify; if PG-023 hasn't landed yet, this package can still emit the metric and author the rule, just note delivery is pending PG-023.
- **PG-026 (Scheduler jobs)** — the new `platform.dr-drill-reminder` job follows the exact same `JobRegistry` pattern PG-026 is auditing/fixing; coordinate so both packages don't duplicate scheduler-file edits in conflicting ways.
- **apps/scheduler-service** — new job registration.
- **notification-service** — reused for the internal quarterly-drill reminder (a legitimate, in-scope use of the app's own notification infra, unlike PG-023's infra alerting).

## Coding Standards

- Shell script additions to `backup.sh` follow its existing `set -euo pipefail`, timestamped-echo logging style — no new scripting language/framework introduced.
- The new scheduler job follows the exact `registry.register(name, { cron, description, tenantScoped }, handler)` signature already used by all 44 existing jobs in `system-jobs.ts` — no new job-registration mechanism.
- `@erp/logger` for any new structured logging in the backup script's Node-side tooling, if any is added (the script itself is bash, so this mainly applies to the scheduler job's reminder logic).

## Performance

- Backup duration is already measured in the drill (34s Postgres, <1s Redis, 4min MinIO for 1.4GB) — as data volume grows, the daily backup window must stay well within the `BACKUP_INTERVAL_SECONDS: "86400"` cadence; this package should note a threshold (e.g., alert if backup duration exceeds 30 minutes) as an early-warning sign of the backup becoming a bottleneck before it becomes an outright failure.
- Offsite copy adds network transfer time/cost proportional to backup size — for MinIO's 1.4GB (drill-measured), this is currently trivial; revisit if attachment/export volume grows substantially.

## Security

- Backup files must be encrypted at rest, especially once an offsite copy exists outside the originating infrastructure's own access boundary (see Current Limitations #4) — this is the single highest-priority security addition in this package given backups are a concentrated, portable, multi-tenant data asset.
- Access to backup storage (both local PVC/volume and any offsite bucket) should be restricted to the backup job's own service account/credentials, not broadly readable by other services or humans without a documented break-glass procedure.
- `PGPASSWORD`/MinIO credentials in `backup.sh`'s env vars are consistent with this repo's current pre-Vault state (see PG-004) — flag as a shared, not-this-package's-to-fully-solve gap, but ensure the *new* offsite-destination credentials this package introduces are not committed in plaintext anywhere (same `.env.example`-placeholder convention as elsewhere).

## Testing

- The **recurring drill itself** is this package's primary "test" — not a Vitest suite. Acceptance is demonstrated by re-running the exact validation checklist `dr-drill-report.md` already used (health checks, login, customer-count match, invoice accessibility, new-invoice creation, trial-balance reconciliation) against a fresh restore from a backup produced by this package's updated `backup.sh`, and confirming RTO/RPO still meet the documented targets after adding offsite-copy/encryption/monitoring overhead.
- Add a lightweight automated check (could be a small Node script or a `apps/scheduler-service` test) that verifies the `erp_backup_last_success_timestamp` metric is being emitted and is fresh, runnable in CI against a mocked backup-completion event, distinct from the full manual drill.

## Acceptance Criteria

- [ ] `infrastructure/runbooks/dr-runbook.md` exists with a concrete, repeatable, step-by-step procedure (the gap `dr-drill-report.md` itself already flagged by referencing a file that didn't exist).
- [ ] A second, geographically/infrastructurally separate backup destination is written to after every successful local backup, verified by actually restoring from the offsite copy at least once.
- [ ] Backup files at the offsite destination are encrypted at rest, verified by confirming the raw file is unreadable without the decryption key.
- [ ] `erp_backup_last_success_timestamp` (or equivalent) is emitted and visible in Prometheus; a `BackupStale` alert rule exists (coordinate with PG-023 for delivery).
- [ ] A `platform.dr-drill-reminder` scheduler job is registered and its cron schedule verified (manually trigger via the existing `triggerManual` path in `JobRegistry` to confirm it fires the reminder correctly).
- [ ] A written DR policy document explicitly states the multi-tenant all-or-nothing restore constraint, the Kafka/Elasticsearch backup-exclusion rationale, and the committed RPO/RTO targets — not implied, stated.
- [ ] A second full DR drill is executed (not just planned) using the updated backup path (offsite + encrypted), and its RTO/RPO are recorded, ideally in a new dated report following `dr-drill-report.md`'s own format for direct comparability.

## Deliverables

- **Files to create:** `infrastructure/runbooks/dr-runbook.md`, a new dated drill report (e.g. `ERP-PLANNING/phase-completions/dr-drill-report-<date>.md`) after re-running the drill, a DR policy document (could live in `ERP-PLANNING/` alongside this package or be folded into the runbook).
- **Files to modify:** `infrastructure/docker/backup/backup.sh` (offsite push, encryption, metrics emission), `infrastructure/docker/backup/entrypoint.sh` if the scheduling/metrics-push logic belongs there instead, `infrastructure/k8s/backup-cronjob.yaml` (same additions for the k8s path), `apps/scheduler-service/src/jobs/system-jobs.ts` (new `platform.dr-drill-reminder` job registration), `.env.example` (new offsite-destination/encryption-key placeholders).
- **Migrations:** none required (optional `backup_history` audit table is a nice-to-have, not required).
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** a CI-runnable check that the backup-success metric emission code path works against a mocked completion event; the recurring manual drill itself (not CI-automatable, by nature of what it tests).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** This codebase already has a working, drill-proven backup and restore capability — `infrastructure/docker/backup/backup.sh` (daily `pg_dump`/Redis `SAVE`/MinIO mirror), a docker-compose `backup` service and a Kubernetes `backup-cronjob.yaml` both running it, and `ERP-PLANNING/phase-completions/dr-drill-report.md` documenting a real, executed restore drill that achieved a 24m17s RTO and 2m16s RPO against 30-min/15-min targets. This is **not a from-scratch DR package** — treat the drill report as a validated baseline, not a stale claim to disprove.

**Current Objective:** Close the gaps the existing drill itself flagged but never followed through on: a missing `infrastructure/runbooks/dr-runbook.md` (referenced by the drill report, never written), no enforced quarterly re-drill cadence, no backup-success monitoring/alerting, no offsite copy, no encryption at rest, and — the one gap no prior document addresses at all — an explicit, written acceptance of the multi-tenant all-or-nothing restore constraint inherent to this codebase's shared-schema-with-`tenant_id`-filtering isolation model.

**Architecture Snapshot:**
1. This package's originating brief incorrectly assumed zero DR documentation existed — a real, successful drill report already exists; read it first.
2. Backup mechanics (pg_dump/Redis SAVE/MinIO mirror) are proven correct — do not rewrite them, only extend (offsite, encryption, monitoring).
3. Multi-tenancy here is shared-schema + `tenant_id`-column filtering, no RLS, no per-tenant database — this means restore is inherently all-tenants-together; this package documents that constraint, it does not attempt to re-architect tenant isolation to fix it.
4. Kafka/Elasticsearch are deliberately excluded from backup (outbox-relay durability + reindex-rebuildability respectively) — this package should make that decision explicit and written, not leave it implicit.
5. `apps/scheduler-service`'s `JobRegistry` (BullMQ + Redis distributed locking) is the existing pattern for any new recurring reminder job — reuse it exactly (see PG-026 for the full audit of that service's 44 registered jobs).

**Completed Components:** The backup scripts, docker-compose/k8s backup services, and the one executed drill and its report.

**Pending Components:** The runbook file, recurring drill enforcement, monitoring/alerting on backup success, offsite copy, encryption at rest, the written multi-tenant-constraint acceptance, a second drill re-run after these changes.

**Known Constraints:** A full DR drill requires spinning up an isolated environment and real validation — if no live Docker/cluster is available in a given session (see `[[es24_no_live_db_available]]`), the runbook/policy-doc work can proceed, but the "re-run the drill" acceptance criterion must wait for an environment where it can actually be executed — do not claim it was re-validated without doing so.

**Coding Standards:** Bash additions match `backup.sh`'s existing `set -euo pipefail` style; new scheduler job matches the exact `registry.register(...)` signature already used 44 times in `system-jobs.ts`.

**Reusable Components:** `backup.sh`/`Dockerfile`/`entrypoint.sh`; `backup-cronjob.yaml`; `dr-drill-report.md`'s validation checklist (health/login/customer-count/invoice/trial-balance) as the re-drill's test plan; `JobRegistry`'s `register`/`triggerManual` API.

**APIs Already Available:** Not directly relevant — this package doesn't add REST endpoints.

**Events Already Available:** Not directly relevant.

**Shared Utilities:** `@erp/logger` for the new scheduler job's logging; `notification-service`'s existing send path for the quarterly-drill reminder.

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** The core deliverable of this package's Multi-Tenant Considerations section — document, do not attempt to solve, the all-tenants-together restore constraint.

**Security Rules:** Backup files must be encrypted at rest once an offsite copy exists; offsite credentials must never be committed in plaintext.

**Database State:** No schema changes required for the core deliverables; an optional `backup_history` table is a nice-to-have.

**Testing Status:** No automated backup-monitoring test exists yet; the drill itself is this package's primary validation mechanism, already proven once.

**Next Session Plan:** Single session is realistic for the documentation/scripting work (runbook, policy doc, backup.sh extensions, scheduler job); the actual re-drill execution may need to be a distinct session/window if it requires coordinated downtime or a live environment not available in the authoring session.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/003-Infrastructure/18-backup-disaster-recovery.md` and implement PG-024. Read `ERP-PLANNING/phase-completions/dr-drill-report.md` first — a real DR drill already passed with a 24m17s RTO / 2m16s RPO; this package hardens that proven baseline (runbook, recurring cadence, offsite copy, encryption, backup-success monitoring) and explicitly documents the multi-tenant all-or-nothing restore constraint, which no existing document states. Re-verify the current state of `infrastructure/docker/backup/` and `infrastructure/k8s/backup-cronjob.yaml` first."
