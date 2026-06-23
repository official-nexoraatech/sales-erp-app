# Permission Quick Reference Guide

## Permission Naming Pattern
```
[ENTITY]_[ACTION]
```

### Standard Actions

| Action | Endpoint Method | CRUD | Example |
|--------|-----------------|------|---------|
| CREATE | POST | Create | `BRAND_CREATE` |
| VIEW | GET | Read | `BRAND_VIEW` |
| UPDATE | PUT | Update | `BRAND_UPDATE` |
| DELETE | DELETE | Delete | `BRAND_DELETE` |
| IMPORT | POST | Create (Bulk) | `ITEM_IMPORT` |
| APPROVE | PUT | Update | `STAFF_LEAVE_APPROVE` |
| REJECT | PUT | Update | `STAFF_LEAVE_REJECT` |
| CANCEL | PUT | Update | `PURCHASE_DELETE` |
| UPLOAD | POST | Create | `ORGANIZATION_LOGO_UPLOAD` |
| SEND | POST | Create | `SMS_SEND` |
| MARK_PAID | PUT | Update | `STAFF_PAYROLL_UPDATE` |

## All Permission Groups

```
Item                    (6)  → ITEM_*
Category                (4)  → CATEGORY_*
Brand                   (4)  → BRAND_*
Unit                    (4)  → UNIT_*
Warehouse               (4)  → WAREHOUSE_*
Customer                (5)  → CUSTOMER_*
Supplier                (5)  → SUPPLIER_*
Carrier                 (4)  → CARRIER_*
Purchase                (4)  → PURCHASE_*
Purchase Return         (2)  → PURCHASE_RETURN_*
Sales                   (5)  → SALES_*
Sales Return            (2)  → SALES_RETURN_*
Payment                 (4)  → PAYMENT_*
Bank Account            (2)  → BANK_ACCOUNT_*
Cash                    (1)  → CASH_*
Expense                 (4)  → EXPENSE_*
Stock                   (4)  → STOCK_*
POS                     (1)  → POS_*
Role                    (4)  → ROLE_*
User                    (8)  → USER_*
Organization            (5)  → ORGANIZATION_*
Staff Employee          (7)  → STAFF_EMPLOYEE_*
Staff Attendance        (3)  → STAFF_ATTENDANCE_*
Staff Leave             (5)  → STAFF_LEAVE_*
Staff Payroll           (3)  → STAFF_PAYROLL_*
Staff Setting           (4)  → STAFF_SETTING_*
SMS                     (5)  → SMS_*
Email                   (5)  → EMAIL_*
Report                  (11) → REPORT_*
Dashboard               (1)  → DASHBOARD_*
Location                (2)  → LOCATION_*
Contact Import          (1)  → CONTACT_*
Authentication          (1)  → LOGIN
```

## Complete Permission List

### Item (6)
- ITEM_CREATE
- ITEM_VIEW
- ITEM_UPDATE
- ITEM_DELETE
- ITEM_STOCK_VIEW
- ITEM_IMPORT

### Category (4)
- CATEGORY_CREATE
- CATEGORY_VIEW
- CATEGORY_UPDATE
- CATEGORY_DELETE

### Brand (4)
- BRAND_CREATE
- BRAND_VIEW
- BRAND_UPDATE
- BRAND_DELETE

### Unit (4)
- UNIT_CREATE
- UNIT_VIEW
- UNIT_UPDATE
- UNIT_DELETE

### Warehouse (4)
- WAREHOUSE_CREATE
- WAREHOUSE_VIEW
- WAREHOUSE_UPDATE
- WAREHOUSE_DELETE

### Customer (5)
- CUSTOMER_CREATE
- CUSTOMER_VIEW
- CUSTOMER_UPDATE
- CUSTOMER_DELETE
- CUSTOMER_LEDGER_VIEW

### Supplier (5)
- SUPPLIER_CREATE
- SUPPLIER_VIEW
- SUPPLIER_UPDATE
- SUPPLIER_DELETE
- SUPPLIER_LEDGER_VIEW

### Carrier (4)
- CARRIER_CREATE
- CARRIER_VIEW
- CARRIER_UPDATE
- CARRIER_DELETE

### Purchase (4)
- PURCHASE_CREATE
- PURCHASE_VIEW
- PURCHASE_UPDATE
- PURCHASE_DELETE

### Purchase Return (2)
- PURCHASE_RETURN_CREATE
- PURCHASE_RETURN_VIEW

### Sales (5)
- SALES_CREATE
- SALES_VIEW
- SALES_UPDATE
- SALES_DELETE
- SALES_INVOICE_PRINT

### Sales Return (2)
- SALES_RETURN_CREATE
- SALES_RETURN_VIEW

### Payment (4)
- PAYMENT_IN_CREATE
- PAYMENT_IN_VIEW
- PAYMENT_OUT_CREATE
- PAYMENT_OUT_VIEW

### Bank Account (2)
- BANK_ACCOUNT_CREATE
- BANK_ACCOUNT_VIEW

### Cash (1)
- CASH_VIEW

### Expense (4)
- EXPENSE_CREATE
- EXPENSE_VIEW
- EXPENSE_UPDATE
- EXPENSE_DELETE

### Stock (4)
- STOCK_ADJUSTMENT_CREATE
- STOCK_ADJUSTMENT_VIEW
- STOCK_TRANSFER_CREATE
- STOCK_TRANSFER_VIEW

### POS (1)
- POS_BILLING_CREATE

### Role (4)
- ROLE_CREATE
- ROLE_VIEW
- ROLE_UPDATE
- ROLE_DELETE

### User (8)
- USER_CREATE
- USER_VIEW
- USER_UPDATE
- USER_DELETE
- USER_PROFILE_VIEW
- USER_PROFILE_UPDATE
- USER_CHANGE_PASSWORD
- USER_PROFILE_IMAGE_UPLOAD

### Organization (5)
- ORGANIZATION_CREATE
- ORGANIZATION_VIEW
- ORGANIZATION_UPDATE
- ORGANIZATION_DELETE
- ORGANIZATION_LOGO_UPLOAD

### Staff Employee (7)
- STAFF_EMPLOYEE_CREATE
- STAFF_EMPLOYEE_VIEW
- STAFF_EMPLOYEE_UPDATE
- STAFF_EMPLOYEE_DELETE
- STAFF_DOCUMENT_UPLOAD
- STAFF_DOCUMENT_VIEW
- STAFF_DOCUMENT_DELETE

### Staff Attendance (3)
- STAFF_ATTENDANCE_CREATE
- STAFF_ATTENDANCE_VIEW
- STAFF_ATTENDANCE_UPDATE

### Staff Leave (5)
- STAFF_LEAVE_CREATE
- STAFF_LEAVE_VIEW
- STAFF_LEAVE_APPROVE
- STAFF_LEAVE_REJECT
- STAFF_LEAVE_CANCEL

### Staff Payroll (3)
- STAFF_PAYROLL_CREATE
- STAFF_PAYROLL_VIEW
- STAFF_PAYROLL_UPDATE

### Staff Setting (4)
- STAFF_SETTING_CREATE
- STAFF_SETTING_VIEW
- STAFF_SETTING_UPDATE
- STAFF_SETTING_DELETE

### SMS (5)
- SMS_TEMPLATE_CREATE
- SMS_TEMPLATE_VIEW
- SMS_TEMPLATE_UPDATE
- SMS_TEMPLATE_DELETE
- SMS_SEND

### Email (5)
- EMAIL_TEMPLATE_CREATE
- EMAIL_TEMPLATE_VIEW
- EMAIL_TEMPLATE_UPDATE
- EMAIL_TEMPLATE_DELETE
- EMAIL_SEND

### Reports (11)
- REPORT_SALES_VIEW
- REPORT_PURCHASE_VIEW
- REPORT_STOCK_VIEW
- REPORT_LOW_STOCK_VIEW
- REPORT_CUSTOMER_LEDGER_VIEW
- REPORT_SUPPLIER_LEDGER_VIEW
- REPORT_PROFIT_LOSS_VIEW
- REPORT_GST_VIEW
- REPORT_INVENTORY_VALUATION_VIEW
- REPORT_TOP_SELLING_ITEMS_VIEW
- REPORT_DAY_BOOK_VIEW

### Dashboard (1)
- DASHBOARD_VIEW

### Location (2)
- COUNTRY_VIEW
- STATE_VIEW

### Contact Import (1)
- CONTACT_IMPORT

### Authentication (1)
- LOGIN

---

## Sample Role Definitions

### Admin Role
```sql
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Admin'
AND p.status = 'ACTIVE'
AND p.is_deleted = FALSE;
```

### Manager Role
```sql
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Manager'
AND p.group_name IN ('Item', 'Category', 'Brand', 'Unit', 'Warehouse', 'Customer', 'Supplier', 'Purchase', 'Sales', 'Payment', 'Expense', 'Stock', 'Report', 'Dashboard');
```

### Sales Executive Role
```sql
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Sales Executive'
AND p.group_name IN ('Customer', 'Sales', 'Sales Return', 'Payment', 'Report', 'Dashboard')
AND p.name NOT LIKE '%DELETE%';
```

### Inventory Staff Role
```sql
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Inventory Staff'
AND p.group_name IN ('Item', 'Warehouse', 'Purchase', 'Stock', 'Report')
AND p.name NOT LIKE '%DELETE%';
```

---

## Common Permission Sets

### View Only Permissions
All permissions ending with `_VIEW` across all modules

### Full CRUD Permissions
`_CREATE`, `_VIEW`, `_UPDATE`, `_DELETE` for specific module

### Financial Module
```
PAYMENT_IN_CREATE
PAYMENT_IN_VIEW
PAYMENT_OUT_CREATE
PAYMENT_OUT_VIEW
BANK_ACCOUNT_CREATE
BANK_ACCOUNT_VIEW
CASH_VIEW
EXPENSE_CREATE
EXPENSE_VIEW
EXPENSE_UPDATE
EXPENSE_DELETE
REPORT_PROFIT_LOSS_VIEW
```

### Inventory Module
```
ITEM_CREATE
ITEM_VIEW
ITEM_UPDATE
ITEM_DELETE
ITEM_STOCK_VIEW
CATEGORY_CREATE
CATEGORY_VIEW
CATEGORY_UPDATE
CATEGORY_DELETE
BRAND_CREATE
BRAND_VIEW
BRAND_UPDATE
BRAND_DELETE
WAREHOUSE_CREATE
WAREHOUSE_VIEW
WAREHOUSE_UPDATE
WAREHOUSE_DELETE
STOCK_ADJUSTMENT_CREATE
STOCK_ADJUSTMENT_VIEW
STOCK_TRANSFER_CREATE
STOCK_TRANSFER_VIEW
```

### HR Module
```
STAFF_EMPLOYEE_CREATE
STAFF_EMPLOYEE_VIEW
STAFF_EMPLOYEE_UPDATE
STAFF_EMPLOYEE_DELETE
STAFF_ATTENDANCE_CREATE
STAFF_ATTENDANCE_VIEW
STAFF_ATTENDANCE_UPDATE
STAFF_LEAVE_CREATE
STAFF_LEAVE_VIEW
STAFF_LEAVE_APPROVE
STAFF_LEAVE_REJECT
STAFF_LEAVE_CANCEL
STAFF_PAYROLL_CREATE
STAFF_PAYROLL_VIEW
STAFF_PAYROLL_UPDATE
```

---

**Total Permissions: 187+**
**Last Updated: 2026-06-22**
