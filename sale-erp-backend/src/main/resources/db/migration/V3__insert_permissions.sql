-- =====================================================
-- Permission Management SQL Script
-- This script inserts all API permissions into the system
-- =====================================================

-- ===================== ITEM MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('ITEM_CREATE', 'Item', 'Create a new item in the inventory', 'POST /api/v1/items', 'ACTIVE', FALSE, NOW(), NOW()),
('ITEM_VIEW', 'Item', 'View items list and retrieve item details', 'GET /api/v1/items, GET /api/v1/items/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ITEM_UPDATE', 'Item', 'Update an existing item', 'PUT /api/v1/items/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ITEM_DELETE', 'Item', 'Delete an item from inventory', 'DELETE /api/v1/items/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ITEM_STOCK_VIEW', 'Item', 'View item stock information', 'GET /api/v1/items/{id}/stock', 'ACTIVE', FALSE, NOW(), NOW()),
('ITEM_IMPORT', 'Item', 'Import items from Excel file', 'POST /api/v1/items/excel/import', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== CATEGORY MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('CATEGORY_CREATE', 'Category', 'Create a new product category', 'POST /api/v1/categories', 'ACTIVE', FALSE, NOW(), NOW()),
('CATEGORY_VIEW', 'Category', 'View categories list', 'GET /api/v1/categories', 'ACTIVE', FALSE, NOW(), NOW()),
('CATEGORY_UPDATE', 'Category', 'Update an existing category', 'PUT /api/v1/categories/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('CATEGORY_DELETE', 'Category', 'Delete a category', 'DELETE /api/v1/categories/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== BRAND MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('BRAND_CREATE', 'Brand', 'Create a new product brand', 'POST /api/v1/brands', 'ACTIVE', FALSE, NOW(), NOW()),
('BRAND_VIEW', 'Brand', 'View brands list and by category', 'GET /api/v1/brands, GET /api/v1/brands/category/{categoryId}', 'ACTIVE', FALSE, NOW(), NOW()),
('BRAND_UPDATE', 'Brand', 'Update an existing brand', 'PUT /api/v1/brands/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('BRAND_DELETE', 'Brand', 'Delete a brand', 'DELETE /api/v1/brands/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== UNIT MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('UNIT_CREATE', 'Unit', 'Create a new measurement unit', 'POST /api/v1/units', 'ACTIVE', FALSE, NOW(), NOW()),
('UNIT_VIEW', 'Unit', 'View units list and retrieve unit details', 'GET /api/v1/units, GET /api/v1/units/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('UNIT_UPDATE', 'Unit', 'Update an existing unit', 'PUT /api/v1/units/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('UNIT_DELETE', 'Unit', 'Delete a unit', 'DELETE /api/v1/units/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== WAREHOUSE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('WAREHOUSE_CREATE', 'Warehouse', 'Create a new warehouse', 'POST /api/v1/warehouses', 'ACTIVE', FALSE, NOW(), NOW()),
('WAREHOUSE_VIEW', 'Warehouse', 'View warehouses list', 'GET /api/v1/warehouses', 'ACTIVE', FALSE, NOW(), NOW()),
('WAREHOUSE_UPDATE', 'Warehouse', 'Update an existing warehouse', 'PUT /api/v1/warehouses/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('WAREHOUSE_DELETE', 'Warehouse', 'Delete a warehouse', 'DELETE /api/v1/warehouses/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== CUSTOMER MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('CUSTOMER_CREATE', 'Customer', 'Create a new customer', 'POST /api/v1/customers', 'ACTIVE', FALSE, NOW(), NOW()),
('CUSTOMER_VIEW', 'Customer', 'View customers list and retrieve customer details', 'GET /api/v1/customers, GET /api/v1/customers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('CUSTOMER_UPDATE', 'Customer', 'Update an existing customer', 'PUT /api/v1/customers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('CUSTOMER_DELETE', 'Customer', 'Delete a customer', 'DELETE /api/v1/customers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('CUSTOMER_LEDGER_VIEW', 'Customer', 'View customer ledger and transactions', 'GET /api/v1/customers/{id}/ledger', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== SUPPLIER MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('SUPPLIER_CREATE', 'Supplier', 'Create a new supplier', 'POST /api/v1/suppliers', 'ACTIVE', FALSE, NOW(), NOW()),
('SUPPLIER_VIEW', 'Supplier', 'View suppliers list and retrieve supplier details', 'GET /api/v1/suppliers, GET /api/v1/suppliers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SUPPLIER_UPDATE', 'Supplier', 'Update an existing supplier', 'PUT /api/v1/suppliers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SUPPLIER_DELETE', 'Supplier', 'Delete a supplier', 'DELETE /api/v1/suppliers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SUPPLIER_LEDGER_VIEW', 'Supplier', 'View supplier ledger and transactions', 'GET /api/v1/suppliers/{id}/ledger', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== CARRIER MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('CARRIER_CREATE', 'Carrier', 'Create a new shipping carrier', 'POST /api/v1/carriers', 'ACTIVE', FALSE, NOW(), NOW()),
('CARRIER_VIEW', 'Carrier', 'View carriers list and retrieve carrier details', 'GET /api/v1/carriers, GET /api/v1/carriers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('CARRIER_UPDATE', 'Carrier', 'Update an existing carrier', 'PUT /api/v1/carriers/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('CARRIER_DELETE', 'Carrier', 'Delete a carrier', 'DELETE /api/v1/carriers/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== PURCHASE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('PURCHASE_CREATE', 'Purchase', 'Create a new purchase order', 'POST /api/v1/purchases', 'ACTIVE', FALSE, NOW(), NOW()),
('PURCHASE_VIEW', 'Purchase', 'View purchases list and retrieve purchase details', 'GET /api/v1/purchases, GET /api/v1/purchases/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('PURCHASE_UPDATE', 'Purchase', 'Update an existing purchase order', 'PUT /api/v1/purchases/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('PURCHASE_DELETE', 'Purchase', 'Cancel a purchase order', 'PUT /api/v1/purchases/{id}/cancel', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== PURCHASE RETURN MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('PURCHASE_RETURN_CREATE', 'Purchase Return', 'Create a new purchase return', 'POST /api/v1/purchase-returns', 'ACTIVE', FALSE, NOW(), NOW()),
('PURCHASE_RETURN_VIEW', 'Purchase Return', 'View purchase returns list and retrieve details', 'GET /api/v1/purchase-returns, GET /api/v1/purchase-returns/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== SALES MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('SALES_CREATE', 'Sales', 'Create a new sales invoice', 'POST /api/v1/sales', 'ACTIVE', FALSE, NOW(), NOW()),
('SALES_VIEW', 'Sales', 'View sales invoices list and retrieve details', 'GET /api/v1/sales, GET /api/v1/sales/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SALES_UPDATE', 'Sales', 'Update an existing sales invoice', 'PUT /api/v1/sales/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SALES_DELETE', 'Sales', 'Cancel a sales invoice', 'PUT /api/v1/sales/{id}/cancel', 'ACTIVE', FALSE, NOW(), NOW()),
('SALES_INVOICE_PRINT', 'Sales', 'Print and retrieve sales invoice', 'GET /api/v1/sales/{id}/invoice', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== SALES RETURN MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('SALES_RETURN_CREATE', 'Sales Return', 'Create a new sales return', 'POST /api/v1/sales-returns', 'ACTIVE', FALSE, NOW(), NOW()),
('SALES_RETURN_VIEW', 'Sales Return', 'View sales returns list and retrieve details', 'GET /api/v1/sales-returns, GET /api/v1/sales-returns/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== PAYMENT MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('PAYMENT_IN_CREATE', 'Payment', 'Record incoming payment from customers', 'POST /api/v1/payment-in', 'ACTIVE', FALSE, NOW(), NOW()),
('PAYMENT_IN_VIEW', 'Payment', 'View incoming payments list and retrieve details', 'GET /api/v1/payment-in, GET /api/v1/payment-in/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('PAYMENT_OUT_CREATE', 'Payment', 'Record outgoing payment to suppliers', 'POST /api/v1/payment-out', 'ACTIVE', FALSE, NOW(), NOW()),
('PAYMENT_OUT_VIEW', 'Payment', 'View outgoing payments list and retrieve details', 'GET /api/v1/payment-out, GET /api/v1/payment-out/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== BANK ACCOUNT MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('BANK_ACCOUNT_CREATE', 'Bank Account', 'Create a new bank account', 'POST /api/v1/bank-accounts', 'ACTIVE', FALSE, NOW(), NOW()),
('BANK_ACCOUNT_VIEW', 'Bank Account', 'View bank accounts list and transactions', 'GET /api/v1/bank-accounts, GET /api/v1/bank-accounts/{id}/transactions', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== CASH MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('CASH_VIEW', 'Cash', 'View cash summary and transactions', 'GET /api/v1/cash/summary, GET /api/v1/cash/transactions', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== EXPENSE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('EXPENSE_CREATE', 'Expense', 'Record a new expense', 'POST /api/v1/expenses', 'ACTIVE', FALSE, NOW(), NOW()),
('EXPENSE_VIEW', 'Expense', 'View expenses list and retrieve expense details', 'GET /api/v1/expenses, GET /api/v1/expenses/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('EXPENSE_UPDATE', 'Expense', 'Update an existing expense', 'PUT /api/v1/expenses/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('EXPENSE_DELETE', 'Expense', 'Delete an expense record', 'DELETE /api/v1/expenses/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== STOCK MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('STOCK_ADJUSTMENT_CREATE', 'Stock', 'Create a stock adjustment', 'POST /api/v1/stocks/adjustments', 'ACTIVE', FALSE, NOW(), NOW()),
('STOCK_ADJUSTMENT_VIEW', 'Stock', 'View stock adjustments list and retrieve details', 'GET /api/v1/stocks/adjustments, GET /api/v1/stocks/adjustments/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('STOCK_TRANSFER_CREATE', 'Stock', 'Transfer stock between warehouses', 'POST /api/v1/stocks/transfers', 'ACTIVE', FALSE, NOW(), NOW()),
('STOCK_TRANSFER_VIEW', 'Stock', 'View stock transfers list and retrieve details', 'GET /api/v1/stocks/transfers, GET /api/v1/stocks/transfers/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== POS MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('POS_BILLING_CREATE', 'POS', 'Generate POS billing for point of sale', 'POST /api/v1/pos/billing', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== ROLE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('ROLE_CREATE', 'Role', 'Create a new role with permissions', 'POST /api/v1/roles', 'ACTIVE', FALSE, NOW(), NOW()),
('ROLE_VIEW', 'Role', 'View roles list and retrieve role details', 'GET /api/v1/roles, GET /api/v1/roles/{id}, GET /api/v1/roles/organization/{organizationId}', 'ACTIVE', FALSE, NOW(), NOW()),
('ROLE_UPDATE', 'Role', 'Update an existing role', 'PUT /api/v1/roles/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ROLE_DELETE', 'Role', 'Delete a role', 'DELETE /api/v1/roles/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== USER MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('USER_CREATE', 'User', 'Create a new user account', 'POST /api/v1/users', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_VIEW', 'User', 'View users list and retrieve user details', 'GET /api/v1/users', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_UPDATE', 'User', 'Update an existing user', 'PUT /api/v1/users/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_DELETE', 'User', 'Delete a user account', 'DELETE /api/v1/users/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_PROFILE_VIEW', 'User', 'View user''s own profile', 'GET /api/v1/users/profile', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_PROFILE_UPDATE', 'User', 'Update user''s own profile', 'PUT /api/v1/users/update-profile', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_CHANGE_PASSWORD', 'User', 'Change user password', 'PUT /api/v1/users/change-password', 'ACTIVE', FALSE, NOW(), NOW()),
('USER_PROFILE_IMAGE_UPLOAD', 'User', 'Upload user profile image', 'POST /api/v1/users/{id}/profile-image', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== ORGANIZATION MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('ORGANIZATION_CREATE', 'Organization', 'Create a new organization', 'POST /api/v1/organizations', 'ACTIVE', FALSE, NOW(), NOW()),
('ORGANIZATION_VIEW', 'Organization', 'View organizations list and retrieve organization details', 'GET /api/v1/organizations, GET /api/v1/organizations/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ORGANIZATION_UPDATE', 'Organization', 'Update an existing organization', 'PUT /api/v1/organizations/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ORGANIZATION_DELETE', 'Organization', 'Delete an organization', 'DELETE /api/v1/organizations/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('ORGANIZATION_LOGO_UPLOAD', 'Organization', 'Upload organization logo', 'POST /api/v1/organizations/{id}/logo', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== STAFF EMPLOYEE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('STAFF_EMPLOYEE_CREATE', 'Staff Employee', 'Create a new employee record', 'POST /api/v1/staff/employees', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_EMPLOYEE_VIEW', 'Staff Employee', 'View employees list and retrieve employee details', 'GET /api/v1/staff/employees, GET /api/v1/staff/employees/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_EMPLOYEE_UPDATE', 'Staff Employee', 'Update an existing employee record', 'PUT /api/v1/staff/employees/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_EMPLOYEE_DELETE', 'Staff Employee', 'Delete an employee record', 'DELETE /api/v1/staff/employees/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_DOCUMENT_UPLOAD', 'Staff Employee', 'Upload employee documents', 'POST /api/v1/staff/employees/{id}/documents', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_DOCUMENT_VIEW', 'Staff Employee', 'View employee documents', 'GET /api/v1/staff/employees/{id}/documents', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_DOCUMENT_DELETE', 'Staff Employee', 'Delete employee documents', 'DELETE /api/v1/staff/employees/{id}/documents/{documentId}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== STAFF ATTENDANCE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('STAFF_ATTENDANCE_CREATE', 'Staff Attendance', 'Mark staff attendance', 'POST /api/v1/staff/attendance', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_ATTENDANCE_VIEW', 'Staff Attendance', 'View attendance records and summary', 'GET /api/v1/staff/attendance, GET /api/v1/staff/attendance/summary', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_ATTENDANCE_UPDATE', 'Staff Attendance', 'Update attendance record', 'PUT /api/v1/staff/attendance/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== STAFF LEAVE MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('STAFF_LEAVE_CREATE', 'Staff Leave', 'Create a leave request', 'POST /api/v1/staff/leaves', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_LEAVE_VIEW', 'Staff Leave', 'View leave requests and balance', 'GET /api/v1/staff/leaves, GET /api/v1/staff/leaves/balance', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_LEAVE_APPROVE', 'Staff Leave', 'Approve a leave request', 'PUT /api/v1/staff/leaves/{id}/approve', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_LEAVE_REJECT', 'Staff Leave', 'Reject a leave request', 'PUT /api/v1/staff/leaves/{id}/reject', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_LEAVE_CANCEL', 'Staff Leave', 'Cancel a leave request', 'PUT /api/v1/staff/leaves/{id}/cancel', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== STAFF PAYROLL MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('STAFF_PAYROLL_CREATE', 'Staff Payroll', 'Generate payroll for staff', 'POST /api/v1/staff/payroll', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_PAYROLL_VIEW', 'Staff Payroll', 'View payroll records and details', 'GET /api/v1/staff/payroll, GET /api/v1/staff/payroll/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_PAYROLL_UPDATE', 'Staff Payroll', 'Mark payroll as paid', 'PUT /api/v1/staff/payroll/{id}/mark-paid', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== STAFF SETTINGS MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('STAFF_SETTING_CREATE', 'Staff Setting', 'Create staff settings', 'POST /api/v1/staff/settings/{type}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_SETTING_VIEW', 'Staff Setting', 'View staff settings', 'GET /api/v1/staff/settings/{type}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_SETTING_UPDATE', 'Staff Setting', 'Update staff settings', 'PUT /api/v1/staff/settings/{type}/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('STAFF_SETTING_DELETE', 'Staff Setting', 'Delete staff settings', 'DELETE /api/v1/staff/settings/{type}/{id}', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== SMS MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('SMS_TEMPLATE_CREATE', 'SMS', 'Create SMS template', 'POST /api/v1/sms/templates', 'ACTIVE', FALSE, NOW(), NOW()),
('SMS_TEMPLATE_VIEW', 'SMS', 'View SMS templates', 'GET /api/v1/sms/templates, GET /api/v1/sms/templates/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SMS_TEMPLATE_UPDATE', 'SMS', 'Update SMS template', 'PUT /api/v1/sms/templates/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SMS_TEMPLATE_DELETE', 'SMS', 'Delete SMS template', 'DELETE /api/v1/sms/templates/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('SMS_SEND', 'SMS', 'Send SMS messages', 'POST /api/v1/sms/send', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== EMAIL MANAGEMENT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('EMAIL_TEMPLATE_CREATE', 'Email', 'Create email template', 'POST /api/v1/email/templates', 'ACTIVE', FALSE, NOW(), NOW()),
('EMAIL_TEMPLATE_VIEW', 'Email', 'View email templates', 'GET /api/v1/email/templates, GET /api/v1/email/templates/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('EMAIL_TEMPLATE_UPDATE', 'Email', 'Update email template', 'PUT /api/v1/email/templates/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('EMAIL_TEMPLATE_DELETE', 'Email', 'Delete email template', 'DELETE /api/v1/email/templates/{id}', 'ACTIVE', FALSE, NOW(), NOW()),
('EMAIL_SEND', 'Email', 'Send email messages', 'POST /api/v1/email/send', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== REPORTS =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('REPORT_SALES_VIEW', 'Report', 'View sales reports', 'GET /api/v1/reports/sales', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_PURCHASE_VIEW', 'Report', 'View purchase reports', 'GET /api/v1/reports/purchases', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_STOCK_VIEW', 'Report', 'View stock reports', 'GET /api/v1/reports/stocks', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_LOW_STOCK_VIEW', 'Report', 'View low stock reports', 'GET /api/v1/reports/low-stock', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_CUSTOMER_LEDGER_VIEW', 'Report', 'View customer ledger reports', 'GET /api/v1/reports/customer-ledger/{customerId}', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_SUPPLIER_LEDGER_VIEW', 'Report', 'View supplier ledger reports', 'GET /api/v1/reports/supplier-ledger/{supplierId}', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_PROFIT_LOSS_VIEW', 'Report', 'View profit and loss reports', 'GET /api/v1/reports/profit-loss', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_GST_VIEW', 'Report', 'View GST reports', 'GET /api/v1/reports/gst', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_INVENTORY_VALUATION_VIEW', 'Report', 'View inventory valuation reports', 'GET /api/v1/reports/inventory-valuation', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_TOP_SELLING_ITEMS_VIEW', 'Report', 'View top selling items reports', 'GET /api/v1/reports/top-selling-items', 'ACTIVE', FALSE, NOW(), NOW()),
('REPORT_DAY_BOOK_VIEW', 'Report', 'View day book reports', 'GET /api/v1/reports/day-book', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== DASHBOARD =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('DASHBOARD_VIEW', 'Dashboard', 'View dashboard summary', 'GET /api/v1/dashboard/summary', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== LOCATIONS =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('COUNTRY_VIEW', 'Location', 'View countries list', 'GET /api/v1/countries', 'ACTIVE', FALSE, NOW(), NOW()),
('STATE_VIEW', 'Location', 'View states by country', 'GET /api/v1/states', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== CONTACTS IMPORT =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('CONTACT_IMPORT', 'Contact Import', 'Import contacts from Excel file', 'POST /api/v1/contacts/excel/import', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== AUTHENTICATION (AUTO-GENERATED) =====================
-- These permissions are typically handled by the system and not assigned manually
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('LOGIN', 'Authentication', 'User login', 'POST /api/v1/auth/login', 'ACTIVE', FALSE, NOW(), NOW());

-- ===================== TEMPLATE DOWNLOAD =====================
INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
('ITEM_TEMPLATE_DOWNLOAD', 'Item', 'Download item import template', 'GET /api/v1/items/excel/template', 'ACTIVE', FALSE, NOW(), NOW()),
('CONTACT_TEMPLATE_DOWNLOAD', 'Contact Import', 'Download contact import template', 'GET /api/v1/contacts/excel/template', 'ACTIVE', FALSE, NOW(), NOW());

-- =====================================================
-- Platform-level Super Admin
-- The "Super Admin" role is platform-wide and intentionally has no organization
-- (organization_id is NULL). It grants access to the /api/v2/admin/** endpoints
-- (see BillTopUserDetails.isSuperAdmin()).
-- =====================================================
INSERT INTO roles (name, status, organization_id, created_by, created_at, is_deleted)
SELECT 'Super Admin', 'ACTIVE', NULL, 'SYSTEM', CURRENT_TIMESTAMP, FALSE
WHERE NOT EXISTS (
    SELECT 1
    FROM roles
    WHERE LOWER(name) = LOWER('Super Admin')
);

INSERT INTO users (
    first_name,
    last_name,
    user_name,
    email,
    mobile_no,
    status,
    role_id,
    organization_id,
    password,
    created_by,
    created_at,
    is_deleted
)
SELECT
    'Dipak',
    'Admin',
    'dipakdagade',
    'dipakdagade@nexoraa.com',
    NULL,
    'ACTIVE',
    role.id,
    NULL,
    '$2a$10$gc2NS8Xm8AdSj11lNVCVB.0sAlsvnx33um8bqAvi4yUW.7Kx.oRTC',
    'SYSTEM',
    CURRENT_TIMESTAMP,
    FALSE
FROM roles role
WHERE LOWER(role.name) = LOWER('Super Admin')
  AND role.is_deleted = FALSE
  AND NOT EXISTS (
      SELECT 1
      FROM users existing_user
      WHERE LOWER(existing_user.user_name) = LOWER('dipakdagade')
         OR LOWER(existing_user.email) = LOWER('dipakdagade@nexoraa.com')
  );

INSERT INTO role_permission_mapping (role_id, permission_id)
SELECT role.id, permission.id
FROM roles role
JOIN permissions permission
    ON permission.status = 'ACTIVE'
   AND permission.is_deleted = FALSE
WHERE LOWER(role.name) = LOWER('Super Admin')
  AND role.is_deleted = FALSE
ON CONFLICT (role_id, permission_id) DO NOTHING;
