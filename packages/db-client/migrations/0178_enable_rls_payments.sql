-- Phase 9 GUC-per-request rollout, step 2 — third and last table in this rollout's original
-- 3-table priority list (invoices 0176, journal_entries 0177, payments here).
--
-- "payments" resolves to exactly one table: packages/db-client/src/schema/sales.ts's `payments`
-- (sales-service's customer AR payment-receipt table — POS + manual "Record Payment"), plus its
-- child `payment_allocations` table (links payments to invoices). Two similarly-named tables were
-- checked and confirmed OUT OF SCOPE: purchase-service's `supplier_payments` (the AP
-- counterpart — a genuinely separate table) and tenant-service's PG-027 Razorpay billing, which
-- has no separate payments table at all (payment state lives on `tenant_invoices` itself).
--
-- Not partitioned (unlike financial_entries in 0177) — a plain bigserial-PK table, same simple
-- shape as invoices' 0176 migration.
--
-- Fresh RLS-readiness audit for this table pair found 14 real call sites. Two were everyday
-- production routes and GUC-unsafe, both fixed as part of this change:
--   - sales-service's POST /payments (Record Payment) — same caveat-4g shape as invoices'
--     POST /invoices/:id/confirm: PaymentNotificationService.notifyPaymentReceived() makes a
--     real fetch() call after its own DB reads. Restructured so all DB work (including the
--     DuplicateOperationError existing-row lookup) runs inside one withTenantConnection wrap,
--     and notifyPaymentReceived (now taking the raw db + tenantId directly) manages its own
--     separate wrap for its own reads, strictly outside the fetch calls.
--   - sales-service's POST /pos/sales (POS checkout, the highest-volume path touching
--     `payments`) — a harder case (checklist caveat 3, not 4): its catch-all failure branch
--     calls svc.cancel() and re-throws, and that compensating write must commit independently
--     of the failed main transaction (OFFLINE-07). The route ALSO turned out to be GUC-unsafe
--     even in its "own transaction" main block — ctx.db.raw.transaction() calls .transaction()
--     on the plain pooled ErpDatabase (TenantScopedDatabase.raw strips the wrapper that would
--     have called set_config), not on TenantScopedDatabase itself, so no GUC was ever set there
--     despite looking like a real transaction. Fixed by giving each independently-committing
--     phase (session verify, DRAFT-invoice create, the confirm/payment/loyalty transaction,
--     each cancel() compensating write, the post-commit cache-invalidation read) its own
--     withTenantConnection wrap — preserving the same independent-commit boundaries caveat 3
--     requires, since each wrap is a real, separate Postgres transaction.
--
-- Deliberately left GUC-unsafe, same accepted/deferred category as invoices and
-- journal_entries: sales-service's internal.routes.ts CRM health-score/predictions cron sweep
-- (raw SQL joining payments, internal-key-guarded, same shape as crm-service's sweeps) and
-- scheduler-service's ExportEngine/exportGenerateJob/ExportScheduleJob/projectionRebuildJobs
-- (BullMQ background jobs and cron, not live request paths).
--
-- FORCE ROW LEVEL SECURITY is required because erp_app (the application role) owns this table
-- and table owners bypass RLS unless forced — same reasoning as 0176/0177.
--
-- No WITH CHECK clause: Postgres reuses USING for write-side validation when none is given, so a
-- write for a mismatched tenant_id is rejected outright, not just hidden afterward.

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" USING (tenant_id = current_tenant_id());
--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_allocations" USING (tenant_id = current_tenant_id());
