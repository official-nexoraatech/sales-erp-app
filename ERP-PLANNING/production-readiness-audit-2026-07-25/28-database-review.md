# 28 — Database-Level Production-Readiness Review

**Scope:** Postgres 16 instance backing all 15 services (single shared database `erp`, single `public` schema, 199 tables). Verified live against `localhost:5435` (container `erp-postgres-primary`) on 2026-07-25. Audit-only — no writes performed.

## Summary

The schema itself is in a healthier state than the "88/104 migrations applied" headline suggested — that gap is **confirmed to be pure tracking-table bookkeeping drift**, not a real schema deficit; all 104 migration files' effects are live in the database. The bigger structural finding is that **this database has zero foreign-key constraints anywhere** (199 tables, 0 FKs) and **zero real CHECK constraints** beyond implicit NOT NULLs — referential integrity is 100% application-enforced, with the sole documented exception of a well-built deferred trigger that enforces debit=credit balance on `financial_entries` and blocks UPDATE/DELETE on posted entries. The `PostingMatrixService` account-code bug family from today's Accounting/Sales audits is directly explained by this: `posting_matrix.debit_account_code`/`credit_account_code` are free-text `varchar(30)` columns matched against `accounts.account_code` via an in-memory JS `Map` at journal-posting time, with **zero DB-level enforcement** — a mismatch silently drops the journal line (`if (!drId || !crId) continue`) instead of erroring. The configured "replica" is not a streaming replica at all (confirmed by docker-compose's own comment and empty `pg_stat_replication`/`pg_replication_slots`) and the container has been down for 4 days. Indexing on the hot financial/operational tables (invoices, journals/financial_entries, inventory_ledger, audit_log, gst_ledger) is actually good — comprehensive tenant-scoped composite indexes exist on all of them. Seed data is aspirational-only; the real `uat-seed` script (500 customers/200 items/50 suppliers) was never run against this dev DB, which instead holds organically-created QA data (31 customers/10 items/9 suppliers).

## 1. Migration Tracking Reconciliation — Definitive Answer

**Confirmed: tracking-table drift only. No real schema gap.**

- `drizzle.__drizzle_migrations` contains exactly 88 rows (ids 1–88), corresponding to journal entries idx 0–87 (`0000_worried_blue_marvel` through `0087_hr_employee_user_link_self_service`).
- `packages/db-client/migrations/meta/_journal.json` lists 104 entries (idx 0–103), matching the 104 `.sql` files on disk through `0103_qa_e2e_employee_user_link_backfill`.
- The 16 untracked migrations (`0088`–`0103`) were individually verified against the live schema/data:
  - `grn_lines.batch_number` — present
  - `supplier_contacts` table — present
  - `organization_settings.purchase_approval_threshold` — present
  - `purchase_requisitions`, `rfqs`, `supplier_quotations`, `purchase_invoices` tables — all present
  - `purchase_orders.po_type`, `purchase_orders.requisition_id` — present
  - `suppliers.rating` — present
  - `payments.client_operation_id` (+ its unique index) — present
  - `delivery_challans.cancelled_at` — present
  - `idx_customers_phone_trgm` — present
  - `organization_settings.logo_object_key` (post-rename) — present
  - `outbox_events.next_retry_at` — present
  - Data backfills: `SALES_MANAGER` role has `CUSTOMER_BLOCK` permission (0097) — confirmed; QA E2E tenant-2 `employees.user_id` links (0103) — confirmed populated.
- **All 16 checks came back positive.** Every migration file on disk has its effect live in the database; the drizzle migration runner's bookkeeping table simply stopped being updated after id 88 (most likely because these 16 were applied via a direct `psql`/script path rather than through the drizzle migrate CLI, or a migration-runner config change silently detached tracking).
- **Risk this creates going forward:** the tracking table is now unreliable for its actual purpose — if someone runs `drizzle-kit migrate` against a _fresh_ database, it will faithfully replay all 104 migrations. But if run again against _this_ database, it will attempt to replay 0088–0103, which are largely idempotent (`IF NOT EXISTS` guards) except **0101** (`RENAME COLUMN "logo_url" TO "logo_object_key"` — not re-runnable, will error on a second attempt since `logo_url` no longer exists) and **0103** (the QA backfill, safe/no-op by design). A next real migration (`0104`) would also be misnumbered against the tracking table's expectation of "id 89 next."
- **Severity: Medium.** Not data-corrupting today, but it's a live footgun for the next migration author and makes `drizzle-kit migrate` unsafe to run blind against this database. Recommend manually backfilling rows 89–104 into `drizzle.__drizzle_migrations` with the correct hashes from `_journal.json` before the next migration is authored.

## 2. Account-Code FK Gap — Structural Root Cause of Today's Biggest Bug Family

**Confirmed: `posting_matrix` account codes are free text with zero DB-level FK to `accounts`.**

```
Table "public.posting_matrix"
 debit_account_code   varchar(30) NOT NULL
 credit_account_code  varchar(30) NOT NULL
Indexes: posting_matrix_pkey, idx_posting_matrix_tenant_event (tenant_id, event_type)
-- no FK constraints of any kind
```

```
Table "public.financial_entries" (partitioned by created_at, 2025/2026/2027)
 account_id    integer NOT NULL   -- no FK to accounts.id
 account_code  varchar(30) NOT NULL  -- denormalized copy, no FK either
```

`accounts` has a unique composite index `accounts_tenant_code (tenant_id, account_code)` that _could_ have backed a composite FK `(tenant_id, debit_account_code) REFERENCES accounts(tenant_id, account_code)` — this was never added. Runtime resolution happens entirely in app code (`apps/accounting-service/src/domain/PostingMatrixService.ts:214-226`):

```ts
const foundAccounts = await db.raw.select({ id: accounts.id, accountCode: accounts.accountCode })
  .from(accounts).where(eq(accounts.tenantId, tenantId));
const codeToId = new Map(foundAccounts.map((a) => [a.accountCode, a.id]));
...
const drId = codeToId.get(rule.debitCode);
const crId = codeToId.get(rule.creditCode);
if (!drId || !crId) continue; // skip unconfigured accounts gracefully
```

A code mismatch (typo in a tenant's posting-matrix override, a rule referencing an account code that was renamed/deleted, case mismatch, etc.) doesn't error — it silently drops **both journal lines for that rule** and processing continues. This is structurally why the sale-return-posts-₹0-to-accounting bug (fixed today, commit `d9d657e`) was possible and went uncaught: nothing in the database or the app raised an exception at write time. A DB-level FK on `posting_matrix` would not have stopped a _runtime_ GST-code miss (GST account codes are resolved dynamically per-event, not stored in `posting_matrix` rows), but it would have caught **misconfigured posting-matrix rules at INSERT time** — the more common real-world failure mode (an admin/tenant typing a wrong account code into the posting matrix UI). Separately, `financial_entries.account_id` having no FK to `accounts.id` means a bug that inserts a non-existent `account_id` would silently create an orphaned, permanently-unresolvable journal line with no database-level backstop; live check today found 0 such orphans, but nothing prevents one.

**Severity: High.** Recommend: (a) add the composite FK on `posting_matrix`, (b) add `financial_entries.account_id → accounts.id` FK, (c) change the app-level `continue` to a hard error/BusinessError so a code-resolution miss fails the transaction instead of silently zeroing it out (this last part is app-code, flagged for the accounting-service follow-up, not a DB change).

## 3. Indexes

Spot-checked FK-shaped columns and common WHERE-clause columns on the largest/hottest tables. **Indexing is in good shape** — this is not a live risk today:

| Table                                                       | Key indexes present                                                                                                                                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoices`                                                  | tenant+status, tenant+status+created_at, tenant+customer+date, tenant+due_date (partial, excludes PAID/CANCELLED), branch, customer, unique(tenant, invoice_number), unique(tenant, client_operation_id) |
| `journals`                                                  | tenant+posted_at, reference_type+reference_id+tenant, reversal_of, unique(tenant, journal_id)                                                                                                            |
| `financial_entries` (the real journal-lines table — see §2) | account_id+tenant+created_at, journal_id+tenant, tenant+created_at; PK is composite (id, created_at) because the table is partitioned                                                                    |
| `inventory_ledger`                                          | tenant+item+warehouse+created_at, tenant+item+created_at DESC (duplicate-looking index — see below), tenant+reference_type+reference_id, tenant+created_at                                               |
| `audit_log`                                                 | entity_type+entity_id+tenant, tenant+created_at                                                                                                                                                          |
| `gst_ledger`                                                | tenant+period+entry_type, tenant+gstin+period, tenant+document_number+entry_type, source_event_id                                                                                                        |

Minor note (not filed as a finding, just an observation): `inventory_ledger` has two overlapping indexes — `idx_inv_ledger_tenant_item_wh (tenant_id, item_id, warehouse_id, created_at)` and `idx_inventory_ledger_tenant_item_date (tenant_id, item_id, created_at DESC)` — the second is largely a prefix-subset of the first's query shape and could likely be dropped once confirmed unused, but this is a minor efficiency cleanup, not correctness.

**No genuinely bare/unindexed hot tables found.** All the tables named in the audit brief (invoices, journals, inventory ledger, audit log) have tenant_id-leading composite indexes matching their actual query patterns in the service code.

**Row counts today are tiny** (dev/QA data, per project memory) — largest table is `role_permissions` at ~31k rows, everything transactional is in the tens-to-hundreds. So there is **no current full-table-scan performance problem**, but that also means the index design has never been load-tested against realistic volume. This is a "looks right on paper, unverified in practice" gap, not a defect.

## 4. Constraints

- **Foreign keys: 0 across the entire 199-table schema.** Verified via `information_schema.table_constraints WHERE constraint_type='FOREIGN KEY'` — zero rows, on every table, not just accounting. This is evidently a deliberate architectural choice (consistent with the project's documented "no cross-service transactional logic" pattern — services are meant to own their tables independently even though they physically share one Postgres instance). It's a defensible choice for genuine cross-service references (e.g., `invoices.customer_id` pointing at a row sales-service and customer data both "own"), but it also means **same-service, same-transaction relationships get no integrity backstop either** (e.g., `financial_entries.account_id → accounts.id`, both owned by accounting-service) — that's the gap worth closing, not the cross-service ones.
- **CHECK constraints: 0 meaningful ones.** All 2,552 rows returned by `information_schema.check_constraints` are Postgres's internal representation of plain `NOT NULL` columns (`check_clause = 'x IS NOT NULL'`); filtering those out leaves **zero** real CHECK constraints anywhere (no status-enum checks, no `debit_amount >= 0`, no GST-rate-range checks, etc.).
- **The one real exception — and it's a good one:** `financial_entries` has two triggers, added back in migration `0002_phase6_accounting.sql`:
  - `validate_journal_balance_trigger` (deferred, fires at transaction commit) — sums debit/credit per `journal_id` and raises an exception if `ABS(SUM(debit)-SUM(credit)) > 0.01`. This is a real, working, DB-enforced "journal must balance" guarantee — it directly answers the audit brief's question "could a trigger enforcing debit=credit have caught an unbalanced journal at the DB level" with **yes, and one already exists and is live.**
  - `prevent_financial_entries_mutation` — blocks UPDATE and DELETE on posted entries, enforcing true append-only ledger semantics at the DB level (correction must be via a reversal row, not a mutation). This is a strong, correctly-designed control.
  - Live-verified: no orphaned `financial_entries.account_id` rows exist today, and no `posting_matrix` rows reference a non-existent account code today — the missing FK hasn't caused live damage _yet_, but nothing stops it from happening on the next misconfiguration.

**Severity: Medium-High** for the FK gap on same-service financially-critical tables (`financial_entries.account_id`, `posting_matrix` account codes); the journal-balance trigger materially reduces the blast radius of _that specific_ bug class (an unbalanced journal can't get posted at all), but it does nothing for the "line silently dropped, journal never even attempted" failure mode described in §2.

## 5. Soft Delete / Audit Columns

Coverage across 199 tables:

| Column       | Tables with it | %   |
| ------------ | -------------- | --- |
| `created_at` | 171            | 86% |
| `updated_at` | 103            | 52% |
| `created_by` | 105            | 53% |
| `updated_by` | 14             | 7%  |
| `deleted_at` | 13             | 7%  |

`deleted_at` is scoped to master/reference data only — `accounts, branches, brands, categories, customers, departments, designations, employees, item_variants, items, price_lists, suppliers, warehouses`. This is actually a sensible, consistent pattern (transactional tables like `invoices`/`journals`/`payments` use status fields like `CANCELLED` instead of soft-delete, which fits the append-only ledger design). **Not flagging soft-delete as inconsistent.**

`updated_by` at only 7% coverage is the real gap: most tables record who _created_ a row (53%) but not who last _changed_ it (7%). For a system with this much regulated financial/HR data, that's a real "who touched this" traceability hole outside of the `audit_log`/`security_audit_log` tables (which capture some but — per today's earlier module audits — not all mutation paths). **Severity: Low-Medium**, mostly a compliance/forensics nicety rather than a correctness risk, since `audit_log` exists as a secondary mechanism.

## 6. Seed Data

- A real seed tool exists: `tools/uat-seed/src/seed.ts` (313 lines, `@faker-js/faker`-based), described in its own `package.json` as generating "500 customers, 200 items, 50 suppliers, 3 months invoices."
- It was **never run against this dev database.** Live counts: 31 customers, 10 items, 9 suppliers, 73 invoices, 28 tenants — nowhere near the seed script's targets, and inconsistent with each other in ways a single deterministic seed run wouldn't produce (e.g., 73 invoices against only 31 customers with just 10 items is consistent with organic QA click-through data, not a bulk faker-generated dataset).
- Dev data has fully drifted from any reproducible baseline — it reflects five-plus weeks of ad hoc QA sessions creating records through the UI/API (consistent with project memory: dev phase, no real data, tenant 2 is the working QA tenant). The 28 `tenants` rows (vs. the documented 2 in `TEST_CREDENTIALS.md`) are almost certainly leftover tenants from platform-admin provisioning QA sessions across the project's history, not a bug — but nobody has cleaned them up.
- **Severity: Low.** Not a defect, but worth flagging: there is no reproducible "known-good" dataset anyone can restore to for load-testing or onboarding a new engineer — `pnpm --filter @erp/uat-seed seed` has apparently never actually been exercised end-to-end against a live database in this environment, so its correctness against the _current_ schema (104 migrations later) is unverified.

## 7. Replica Health

**The configured "replica" is not a streaming replica, and it is currently not even running.**

- `docker-compose.yml` line 26 states outright: `# ─── PostgreSQL 16 Replica (second instance for dev — not streaming replication) ──`. It's a second, independent Postgres 16 instance with its own data directory (`postgres_replica_data` volume) and no `primary_conninfo`, no `standby.signal`, no replication user wiring to the primary — it is not a hot standby, just a same-shaped empty/independent database.
- Confirmed on the primary: `pg_stat_replication` returns 0 rows and `pg_replication_slots` returns 0 rows — no client (physical or logical) has ever streamed from this primary. `wal_level = replica` is set (so streaming _could_ be configured) but nothing consumes it.
- The `erp-postgres-replica` container itself has been **stopped for 4 days** (`docker ps -a`: `Exited (137) 4 days ago`, last activity 2026-07-20T16:46 UTC — a clean fast-shutdown, not a crash; `OOMKilled=false`). Nobody has restarted it since.
- `erp-postgres-exporter` (Prometheus metrics for Postgres) is also stopped, same timeframe.
- **Severity: High** if anything in the codebase or ops runbooks assumes a working read replica exists (e.g., read-heavy report queries routed to a "replica" for load-shedding) — it does not, and never has. If nothing actually depends on it yet, this is a documentation/naming problem today (`docker-compose.yml`'s own comment is honest about it) but it means "replica" language anywhere else in the repo (deploy docs, ops runbooks) is aspirational, not real. Recommend either building real streaming replication before launch, or renaming the service to stop implying it exists.

## 8. Transactions/Rollback

Out of scope per the audit brief — the `PlatformEventConsumer` same-transaction-rollback anti-pattern found earlier today is an application-code issue, not a database-schema/config issue, and is not re-litigated here.

## Readiness Score: 62/100

**Justification:**

- **+ Strong:** indexing on hot financial/operational tables is comprehensive and tenant-scoped correctly; the journal-balance trigger and append-only enforcement on `financial_entries` are genuinely well-engineered DB-level controls that most teams skip; migration tracking gap is confirmed cosmetic, not a real schema deficit; soft-delete pattern is coherently scoped to master data.
- **− Weak:** zero foreign keys anywhere (including same-service relationships that have no cross-service excuse), zero real CHECK constraints outside the one journal-balance trigger, the account-code matching pattern that caused today's biggest bug family has no structural DB backstop, "replica" is not a replica at all and has been down for 4 days unnoticed, seed data is fictional relative to actual dev-DB contents, `updated_by` traceability is present on only 7% of tables.
- The schema is **not corrupt and not silently broken** — every migration file's effect is genuinely live, there are no orphaned rows today, and the one place a DB-level financial-integrity control was needed most (journal balancing) already has one. But the near-total absence of FK/CHECK enforcement means the database is trusting application code for _everything_ except journal-balance and append-only-ness — exactly the failure mode that produced several of today's confirmed application bugs (wrong data written, not caught anywhere until a human QA pass found it). That gap, plus a completely non-functional "replica," are the two items most worth fixing before a production launch that has real money and real replication/DR requirements riding on it.

---

_Companion findings from today's 27 module audits are referenced but not re-derived here; see `ERP-PLANNING/production-readiness-audit-2026-07-25/01-27` for the application-layer bugs this review provides DB-level context for._
