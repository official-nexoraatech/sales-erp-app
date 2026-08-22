-- Phase 9 GUC-per-request rollout, step 2 — second table enabled for Row-Level Security, per
-- ERP-PLANNING/multi-industry-platform/13-security-architecture.md's own sequencing (invoices
-- done in 0176; journal_entries next; payments after).
--
-- "journal_entries" in the security doc's terminology maps to TWO tightly-coupled tables in this
-- schema: `journals` (header) and `financial_entries` (DR/CR lines, joined via the varchar
-- journal_id ULID, not journals.id). Both get the same policy shape — neither is meaningful
-- without the other.
--
-- Fresh RLS-readiness audit for this table pair (does NOT reuse the invoices audit's findings)
-- found ZERO everyday-production routes unsafe — journal.routes.ts, accounts.routes.ts,
-- bank.routes.ts, financial-year.routes.ts, reports.routes.ts, fixed-assets.routes.ts, and
-- tds.routes.ts are all already tenantScopedHandler-wrapped, and the shared financial-reports
-- engine (packages/platform-sdk/src/financial-reports-engine.ts) and report-service's
-- ReportEngine both receive an already-scoped db. No caveat-4g (fetch-interleaved-with-DB-work)
-- fix was needed anywhere in this table's call sites.
--
-- Deliberately left GUC-unsafe, same accepted/deferred category as the invoices migration:
--   - accounting-service's 12 Kafka consumers (Invoice/GRN/Cogs/Payment/SaleReturn/
--     PurchaseReturn/Expense/Payroll/EmployeeLoan/Rcm/StockAdjustment/Commission), dispatched
--     against a bootstrap-time singleton db, never per-request wrapped. JournalEngine.post()'s
--     own internal db.transaction() still sets the GUC correctly for its own inserts; only the
--     Invoice/Payment consumers' pre-reversal SELECTs on `journals` are genuinely unscoped and
--     will now hit "tenant context not set" on a warmed connection. That SELECT returning zero
--     rows already surfaces as the existing BusinessError('JOURNAL_NOT_FOUND_FOR_REVERSAL', ...)
--     guard, which routes to the DLQ for retry rather than silently no-op'ing a reversal — an
--     acceptable failure mode for a financial table, safer than the alternative of skipping RLS.
--   - scheduler-service's `accounting.zero-value-journal-audit` cron (read-only/detection-only —
--     failure mode is "silently finds nothing to flag", not data corruption).
--   - scheduler-service's `platform.partition-maintenance` job — DDL only (CREATE TABLE ...
--     PARTITION OF), no tenant predicate involved either way, unaffected by RLS.
--
-- `financial_entries` is PARTITION BY RANGE (created_at) with pre-created yearly partitions
-- (financial_entries_2025/2026/2027 — see 0002_phase6_accounting.sql) plus future ones added by
-- the partition-maintenance job above.
--
-- IMPORTANT, confirmed empirically (NOT the naive assumption): a partitioned parent's POLICY
-- objects are shared by the whole hierarchy automatically, but relrowsecurity/
-- relforcerowsecurity (the ENABLE/FORCE flags) are NOT inherited — each partition starts with
-- both flags false regardless of the parent's setting. A query against the parent
-- (`financial_entries`) is safely filtered once the parent has RLS enabled, but a query naming a
-- specific yearly partition directly (`financial_entries_2026`) bypasses RLS entirely and returns
-- every tenant's rows until that partition's own flags are set. Verified live: with flags unset
-- on `financial_entries_2026`, a direct SELECT returned all rows under any GUC state (including
-- unset); after `ENABLE`+`FORCE ROW LEVEL SECURITY` on the partition itself (no separate
-- `CREATE POLICY` needed — the parent's `tenant_isolation` policy applies automatically once the
-- partition's own flags are on), the same direct query became correctly tenant-filtered and
-- fail-closed. All 3 existing partitions get explicit ALTER TABLE statements below.
--
-- This means the scheduler-service `platform.partition-maintenance` job (creates next year's
-- partition every Dec 1) MUST also enable+force RLS on the partition it just created, or every
-- new partition reopens this exact gap for a full year until caught. Fixed in the same change as
-- this migration (see apps/scheduler-service/src/jobs/system-jobs.ts).
--
-- FORCE ROW LEVEL SECURITY is required because erp_app (the application role) owns these tables
-- and table owners bypass RLS unless forced — same reasoning as 0176.
--
-- No WITH CHECK clause: Postgres reuses USING for write-side validation when none is given, so a
-- write for a mismatched tenant_id is rejected outright, not just hidden afterward.

ALTER TABLE "journals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journals" USING (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE "financial_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "financial_entries" USING (tenant_id = current_tenant_id());
--> statement-breakpoint
-- Existing partitions: ENABLE/FORCE flags are not inherited from the parent, must be set on each.
ALTER TABLE "financial_entries_2025" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries_2025" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries_2026" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries_2026" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries_2027" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_entries_2027" FORCE ROW LEVEL SECURITY;
