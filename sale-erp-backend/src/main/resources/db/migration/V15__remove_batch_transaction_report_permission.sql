-- =====================================================
-- Remove Batch Transaction Report
-- The item-transactions/batch report endpoint and its
-- permission are no longer used by the application.
-- =====================================================
DELETE FROM role_permission_mapping
WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'REPORT_ITEM_TRANSACTIONS_BATCH_VIEW');

DELETE FROM user_permission_mapping
WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'REPORT_ITEM_TRANSACTIONS_BATCH_VIEW');

DELETE FROM permissions WHERE name = 'REPORT_ITEM_TRANSACTIONS_BATCH_VIEW';
