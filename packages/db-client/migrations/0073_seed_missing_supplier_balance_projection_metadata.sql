-- Found in live QA 2026-07-17 while chasing the "value.toISOString is not a function" bug on
-- projection_dashboard_daily/projection_customer_balance: projection_supplier_balance has a
-- fully wired rebuild function (projectionRebuildJobs.ts), BullMQ queue, and admin rebuild
-- route, but 0006_phase12_distributed.sql's seed list never included it. With no
-- projection_metadata row, POST /admin/projections/projection_supplier_balance/rebuild has
-- 404'd since this projection was introduced, and it has never appeared in the Projections
-- admin list at all.
INSERT INTO "projection_metadata" ("projection_name", "tenant_id", "status") VALUES
  ('projection_supplier_balance', NULL, 'UP_TO_DATE')
ON CONFLICT ("projection_name", "tenant_id") DO NOTHING;
