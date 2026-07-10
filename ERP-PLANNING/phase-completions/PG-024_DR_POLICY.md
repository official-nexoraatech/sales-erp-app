# Backup & Disaster Recovery Policy (PG-024)

**Status:** Adopted 2026-07-10. Supersedes nothing — this is the first written DR
policy; it formalizes targets `dr-drill-report.md` (2026-07-01) already measured
and states constraints no prior document addressed.

---

## 1. Committed RPO / RTO targets

| Tier | RPO | RTO | Basis |
|---|---|---|---|
| **Standard** (current, only tier) | ≤ 15 minutes | ≤ 30 minutes | `dr-drill-report.md` measured 2m16s RPO / 24m17s RTO against these targets on 2026-07-01 — both PASS, RPO far exceeds target. |
| Enterprise (not offered today) | would need seconds, not minutes | would need < 5 min | Requires continuous WAL archiving (not just daily `pg_dump`) and a hot/warm standby, not just backup+restore. Noted as a future option per the drill's own recommendation #1; **not built by this package**. |

These targets apply to the **Postgres primary** specifically, since it is the
system of record for every invoice, ledger entry, and customer record. See §3
for why Redis/Kafka/Elasticsearch are held to different, explicitly lower
standards.

## 2. Backup schedule (per store)

| Store | Schedule | Mechanism | Rigor |
|---|---|---|---|
| PostgreSQL | Daily | `pg_dump -Fc` (full logical dump) | Primary — this is the RPO/RTO-bearing backup. |
| Redis | Daily | `redis-cli SAVE` (RDB snapshot) | Deliberately lower — Redis here holds cache/session/distributed-lock state, not source-of-truth financial data. A stale Redis restore only means re-warmed caches and re-issued sessions, not lost business data. |
| MinIO | Daily | `mc mirror` | Same rigor as Postgres — MinIO holds tenant-uploaded documents/attachments, which are source-of-truth for their tenant even though they're not relational data. |
| Offsite copy (all of the above) | Daily, after local backup succeeds | `age`-encrypted, `mc cp` to a separate S3-compatible bucket (`OFFSITE_MINIO_*`) | Protects against a full site/cluster loss, not just a disk failure — see §4. |
| Kafka | **Not backed up** | — | See §3.1. |
| Elasticsearch | **Not backed up** | — | See §3.2. |

## 3. Explicit exclusions

### 3.1 Kafka

Kafka is not backed up. This is a deliberate decision, not an oversight, but
the reasoning has a nuance worth stating precisely rather than hand-waving as
"Kafka is always replayable":

- The transactional outbox pattern means every business-state change is
  durably recorded in Postgres (`outbox_events`) in the *same* transaction as
  the change itself — Postgres, not Kafka, is the durability boundary for
  anything not yet relayed.
- Once relayed, `outbox_events` rows are cleaned up by
  `platform.outbox-cleanup` (see PG-026) — the outbox is a **relay staging
  buffer, not a permanent replay log**. It cannot replay a message that was
  already consumed and then subsequently lost from Kafka's own log.
- Therefore: a Postgres restore correctly recovers everything **not yet
  relayed** at backup time (it replays from the restored `outbox_events`
  automatically once the relay worker restarts). It does **not** recover
  Kafka messages that were relayed and consumed *before* the backup was taken
  but whose only other copy (e.g. a downstream projection, `search-service`'s
  Elasticsearch index) is also lost in the same incident. Each downstream
  consumer owns its own rebuild story for that case — e.g. Elasticsearch's is
  §3.2 below.

### 3.2 Elasticsearch

Elasticsearch has no backup mechanism. Accepted rebuild path:
`search.full-reindex` (weekly scheduler job, see PG-026) rebuilds the entire
index from Postgres, which remains the system of record for everything
Elasticsearch indexes. **This has its own RTO, and it is not the same 30-minute
target as the rest of the system** — a full reindex across a large tenant base
is expected to take materially longer than 30 minutes (exact figure depends on
data volume and has not been separately measured as of this writing). Search
being briefly stale or slow to rebuild is an accepted, lower-severity outage
mode compared to Postgres/MinIO data loss.

## 4. Offsite copy and encryption

- Every successful local backup is `age`-encrypted and pushed to a second,
  infrastructurally-separate S3-compatible bucket (`OFFSITE_MINIO_*`) —
  see `backup.sh` §4 and `infrastructure/runbooks/dr-runbook.md` §1.
- The decryption private key is **never** stored in this repository or in
  the backup infrastructure itself — it lives in Vault (once PG-004 lands) or
  a documented manual key-custody process until then. `backup.sh` only ever
  holds the `age` **public** (encryption) key.
- Rationale: backup files are a single, portable, concentrated copy of **all**
  tenants' financial data (see §5) — a leaked or stolen backup file is a full
  multi-tenant breach, not a single customer's exposure. This is a materially
  higher-value target than a live, access-controlled DB connection, and is
  treated accordingly.

## 5. Multi-tenant restore constraint (accepted, not solved)

This codebase uses a **single shared PostgreSQL schema** with `tenant_id`-column
isolation — no per-tenant database, no row-level security. This has a direct,
unavoidable consequence for disaster recovery:

> **A restore is all-tenants-or-nothing.** `pg_restore` operates on the whole
> database; there is no supported mechanism to restore Tenant A's data to an
> earlier point in time while leaving Tenant B, C, D... on current data.

If a single tenant needs point-in-time recovery (e.g. they accidentally
deleted a quarter of invoices) but every other tenant must stay on live data,
the only available path today is a **manual, ad hoc, error-prone** procedure:
`pg_restore` the backup into a scratch database, then hand-write
`INSERT ... SELECT ... WHERE tenant_id = X` reconciliation scripts at incident
time — which itself risks violating referential integrity if done carelessly
(e.g. restoring a customer without its invoices, or vice versa, across dozens
of interrelated tables).

**This package documents and accepts this constraint. It does not attempt to
solve it.** A genuinely isolated per-tenant recovery capability would require a
per-tenant-schema or per-tenant-database architecture change — a significant,
separate architectural decision, out of scope here and likely warranting its
own gap-prompt package if the business ever needs it (e.g. driven by an
enterprise customer's contractual RPO/RTO requirements that a shared-schema
restore can't meet).

Because backup files contain all tenants' data commingled in a single dump,
this also means every backup file is, by construction, a full multi-tenant
data asset — reinforcing why §4's encryption-at-rest and access-control
requirements are non-negotiable rather than a nice-to-have.

## 6. Monitoring

- `erp_backup_last_success_timestamp`, `erp_backup_duration_seconds`,
  `erp_backup_size_bytes`, `erp_backup_offsite_success` are pushed to
  Prometheus Pushgateway by every `backup.sh` run and scraped from there by
  Prometheus (see `infrastructure/docker/prometheus/prometheus.yml`
  `pushgateway` job).
- `BackupStale` (Alertmanager, `infrastructure/docker/prometheus/alert-rules.yml`)
  fires if no successful backup has pushed a fresh timestamp in >25 hours.
  Delivery depends on PG-023's Alertmanager routing, which is already live.
- `BackupDurationHigh` fires as an early-warning if a single backup run exceeds
  30 minutes — well before it risks exceeding the 24-hour cadence itself.

## 7. Recurring drill cadence

- Quarterly, first of Jan/Apr/Jul/Oct, enforced by the
  `platform.dr-drill-reminder` scheduler job (not an automated drill — a full
  restore drill needs human validation of business-data correctness; the job
  only reminds/tickets the owner). See `infrastructure/runbooks/dr-runbook.md`.
- Each drill produces a new dated report in `ERP-PLANNING/phase-completions/`
  following `dr-drill-report.md`'s format, so RTO/RPO trends are directly
  comparable quarter over quarter.

## 8. Known gap at time of writing

The 2026-07-01 drill validated the **pre-PG-024** backup path (local-only, no
offsite copy, no encryption). The offsite+encrypted path built in this package
has not yet been drilled end-to-end against a real restore — no live
Docker/cluster environment was available in the authoring session (see
`dr-runbook.md`'s own prerequisites). **Do not treat the offsite/encrypted
path as drill-proven until a dated report confirms it** — this is the single
open acceptance-criteria item from the PG-024 gap-prompt, tracked in
`PG-024_COMPLETION.md`.
