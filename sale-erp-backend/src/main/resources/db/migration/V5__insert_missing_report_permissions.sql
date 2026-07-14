-- =====================================================
-- Missing Report Permissions
-- Adds permissions for report endpoints that exist in
-- ReportController but were never inserted in V3.
-- =====================================================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('REPORT_CUSTOMER_DUES_VIEW', 'Report', 'View customer dues reports', 'GET /api/v1/reports/customer-dues', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_SUPPLIER_DUES_VIEW', 'Report', 'View supplier dues reports', 'GET /api/v1/reports/supplier-dues', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_PURCHASE_PAYMENTS_VIEW', 'Report', 'View purchase payments reports', 'GET /api/v1/reports/purchase-payments', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_SALE_PAYMENTS_VIEW', 'Report', 'View sale payments reports', 'GET /api/v1/reports/sale-payments', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_EXPENSE_ITEMS_VIEW', 'Report', 'View expense items reports', 'GET /api/v1/reports/expense-items', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_EXPENSE_PAYMENTS_VIEW', 'Report', 'View expense payments reports', 'GET /api/v1/reports/expense-payments', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_BANK_STATEMENT_VIEW', 'Report', 'View bank statement reports', 'GET /api/v1/reports/bank-statement', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_ITEM_TRANSACTIONS_BATCH_VIEW', 'Report', 'View item transactions batch reports', 'GET /api/v1/reports/item-transactions/batch', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_ITEM_TRANSACTIONS_GENERAL_VIEW', 'Report', 'View item transactions general reports', 'GET /api/v1/reports/item-transactions/general', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_ITEM_TRANSACTIONS_SERIAL_VIEW', 'Report', 'View item transactions serial reports', 'GET /api/v1/reports/item-transactions/serial', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_EXPIRED_ITEMS_VIEW', 'Report', 'View expired items reports', 'GET /api/v1/reports/expired-items', 'ACTIVE', FALSE, NOW(), NOW());

-- Grant new permissions to Super Admin role automatically
INSERT INTO role_permission_mapping (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
JOIN permissions permission
    ON permission.status = 'ACTIVE'
   AND permission.is_deleted = FALSE
   AND permission.name IN (
       'REPORT_CUSTOMER_DUES_VIEW',
       'REPORT_SUPPLIER_DUES_VIEW',
       'REPORT_PURCHASE_PAYMENTS_VIEW',
       'REPORT_SALE_PAYMENTS_VIEW',
       'REPORT_EXPENSE_ITEMS_VIEW',
       'REPORT_EXPENSE_PAYMENTS_VIEW',
       'REPORT_BANK_STATEMENT_VIEW',
       'REPORT_ITEM_TRANSACTIONS_BATCH_VIEW',
       'REPORT_ITEM_TRANSACTIONS_GENERAL_VIEW',
       'REPORT_ITEM_TRANSACTIONS_SERIAL_VIEW',
       'REPORT_EXPIRED_ITEMS_VIEW'
   )
WHERE LOWER(role.name) = LOWER('Super Admin')
  AND role.is_deleted = FALSE
ON CONFLICT (role_id, permission_id) DO NOTHING;
