# Complete API Endpoints Reference with Permissions

## Overview
This document maps all 187+ API endpoints to their corresponding permissions. Organized by controller.

---

## 📋 API Endpoints by Controller (37 Controllers)

### 1. **Item Controller** (8 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/items/excel/template` | ITEM_IMPORT | Download import template |
| POST | `/api/v1/items/excel/import` | ITEM_IMPORT | Import items from Excel |
| POST | `/api/v1/items` | ITEM_CREATE | Create new item |
| GET | `/api/v1/items/{id}` | ITEM_VIEW | Get item by ID |
| GET | `/api/v1/items` | ITEM_VIEW | List all items |
| PUT | `/api/v1/items/{id}` | ITEM_UPDATE | Update item |
| DELETE | `/api/v1/items/{id}` | ITEM_DELETE | Delete item |
| GET | `/api/v1/items/{id}/stock` | ITEM_STOCK_VIEW | Get item stock |

### 2. **Category Controller** (4 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/categories` | CATEGORY_CREATE | Create category |
| GET | `/api/v1/categories` | CATEGORY_VIEW | List categories |
| PUT | `/api/v1/categories/{id}` | CATEGORY_UPDATE | Update category |
| DELETE | `/api/v1/categories/{id}` | CATEGORY_DELETE | Delete category |

### 3. **Brand Controller** (5 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/brands` | BRAND_CREATE | Create brand |
| GET | `/api/v1/brands` | BRAND_VIEW | List brands |
| GET | `/api/v1/brands/category/{categoryId}` | BRAND_VIEW | Get brands by category |
| PUT | `/api/v1/brands/{id}` | BRAND_UPDATE | Update brand |
| DELETE | `/api/v1/brands/{id}` | BRAND_DELETE | Delete brand |

### 4. **Unit Controller** (5 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/units` | UNIT_CREATE | Create unit |
| GET | `/api/v1/units` | UNIT_VIEW | List units |
| GET | `/api/v1/units/{id}` | UNIT_VIEW | Get unit by ID |
| PUT | `/api/v1/units/{id}` | UNIT_UPDATE | Update unit |
| DELETE | `/api/v1/units/{id}` | UNIT_DELETE | Delete unit |

### 5. **Warehouse Controller** (4 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/warehouses` | WAREHOUSE_CREATE | Create warehouse |
| GET | `/api/v1/warehouses` | WAREHOUSE_VIEW | List warehouses |
| PUT | `/api/v1/warehouses/{id}` | WAREHOUSE_UPDATE | Update warehouse |
| DELETE | `/api/v1/warehouses/{id}` | WAREHOUSE_DELETE | Delete warehouse |

### 6. **Customer Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/customers` | CUSTOMER_CREATE | Create customer |
| PUT | `/api/v1/customers/{id}` | CUSTOMER_UPDATE | Update customer |
| GET | `/api/v1/customers/{id}` | CUSTOMER_VIEW | Get customer by ID |
| GET | `/api/v1/customers` | CUSTOMER_VIEW | List customers |
| DELETE | `/api/v1/customers/{id}` | CUSTOMER_DELETE | Delete customer |
| GET | `/api/v1/customers/{id}/ledger` | CUSTOMER_LEDGER_VIEW | Get customer ledger |

### 7. **Supplier Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/suppliers` | SUPPLIER_CREATE | Create supplier |
| GET | `/api/v1/suppliers` | SUPPLIER_VIEW | List suppliers |
| GET | `/api/v1/suppliers/{id}` | SUPPLIER_VIEW | Get supplier by ID |
| PUT | `/api/v1/suppliers/{id}` | SUPPLIER_UPDATE | Update supplier |
| DELETE | `/api/v1/suppliers/{id}` | SUPPLIER_DELETE | Delete supplier |
| GET | `/api/v1/suppliers/{id}/ledger` | SUPPLIER_LEDGER_VIEW | Get supplier ledger |

### 8. **Carrier Controller** (5 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/carriers` | CARRIER_CREATE | Create carrier |
| GET | `/api/v1/carriers` | CARRIER_VIEW | List carriers |
| GET | `/api/v1/carriers/{id}` | CARRIER_VIEW | Get carrier by ID |
| PUT | `/api/v1/carriers/{id}` | CARRIER_UPDATE | Update carrier |
| DELETE | `/api/v1/carriers/{id}` | CARRIER_DELETE | Delete carrier |

### 9. **Purchase Controller** (5 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/purchases` | PURCHASE_CREATE | Create purchase |
| GET | `/api/v1/purchases` | PURCHASE_VIEW | List purchases |
| GET | `/api/v1/purchases/{id}` | PURCHASE_VIEW | Get purchase by ID |
| PUT | `/api/v1/purchases/{id}` | PURCHASE_UPDATE | Update purchase |
| PUT | `/api/v1/purchases/{id}/cancel` | PURCHASE_DELETE | Cancel purchase |

### 10. **Purchase Return Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/purchase-returns` | PURCHASE_RETURN_CREATE | Create purchase return |
| GET | `/api/v1/purchase-returns` | PURCHASE_RETURN_VIEW | List returns |
| GET | `/api/v1/purchase-returns/{id}` | PURCHASE_RETURN_VIEW | Get return by ID |

### 11. **Sales Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/sales` | SALES_CREATE | Create sale |
| GET | `/api/v1/sales` | SALES_VIEW | List sales |
| GET | `/api/v1/sales/{id}` | SALES_VIEW | Get sale by ID |
| PUT | `/api/v1/sales/{id}` | SALES_UPDATE | Update sale |
| PUT | `/api/v1/sales/{id}/cancel` | SALES_DELETE | Cancel sale |
| GET | `/api/v1/sales/{id}/invoice` | SALES_INVOICE_PRINT | Print invoice |

### 12. **Sales Return Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/sales-returns` | SALES_RETURN_CREATE | Create sales return |
| GET | `/api/v1/sales-returns` | SALES_RETURN_VIEW | List returns |
| GET | `/api/v1/sales-returns/{id}` | SALES_RETURN_VIEW | Get return by ID |

### 13. **Payment In Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/payment-in` | PAYMENT_IN_CREATE | Create payment in |
| GET | `/api/v1/payment-in` | PAYMENT_IN_VIEW | List payments in |
| GET | `/api/v1/payment-in/{id}` | PAYMENT_IN_VIEW | Get payment in by ID |

### 14. **Payment Out Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/payment-out` | PAYMENT_OUT_CREATE | Create payment out |
| GET | `/api/v1/payment-out` | PAYMENT_OUT_VIEW | List payments out |
| GET | `/api/v1/payment-out/{id}` | PAYMENT_OUT_VIEW | Get payment out by ID |

### 15. **Bank Account Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/bank-accounts` | BANK_ACCOUNT_CREATE | Create bank account |
| GET | `/api/v1/bank-accounts` | BANK_ACCOUNT_VIEW | List bank accounts |
| GET | `/api/v1/bank-accounts/{id}/transactions` | BANK_ACCOUNT_VIEW | Get transactions |

### 16. **Cash Controller** (2 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/cash/summary` | CASH_VIEW | Get cash summary |
| GET | `/api/v1/cash/transactions` | CASH_VIEW | Get cash transactions |

### 17. **Expense Controller** (5 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/expenses` | EXPENSE_CREATE | Create expense |
| GET | `/api/v1/expenses` | EXPENSE_VIEW | List expenses |
| GET | `/api/v1/expenses/{id}` | EXPENSE_VIEW | Get expense by ID |
| PUT | `/api/v1/expenses/{id}` | EXPENSE_UPDATE | Update expense |
| DELETE | `/api/v1/expenses/{id}` | EXPENSE_DELETE | Delete expense |

### 18. **Stock Adjustment Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/stocks/adjustments` | STOCK_ADJUSTMENT_CREATE | Create adjustment |
| GET | `/api/v1/stocks/adjustments` | STOCK_ADJUSTMENT_VIEW | List adjustments |
| GET | `/api/v1/stocks/adjustments/{id}` | STOCK_ADJUSTMENT_VIEW | Get adjustment by ID |

### 19. **Stock Transfer Controller** (3 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/stocks/transfers` | STOCK_TRANSFER_CREATE | Transfer stock |
| GET | `/api/v1/stocks/transfers` | STOCK_TRANSFER_VIEW | List transfers |
| GET | `/api/v1/stocks/transfers/{id}` | STOCK_TRANSFER_VIEW | Get transfer by ID |

### 20. **POS Billing Controller** (1 endpoint)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/pos/billing` | POS_BILLING_CREATE | Create POS bill |

### 21. **Role Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/roles` | ROLE_CREATE | Create role |
| GET | `/api/v1/roles` | ROLE_VIEW | List roles |
| GET | `/api/v1/roles/{id}` | ROLE_VIEW | Get role by ID |
| GET | `/api/v1/roles/organization/{orgId}` | ROLE_VIEW | Get org roles |
| PUT | `/api/v1/roles/{id}` | ROLE_UPDATE | Update role |
| DELETE | `/api/v1/roles/{id}` | ROLE_DELETE | Delete role |

### 22. **User Controller** (8 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/users` | USER_CREATE | Create user |
| GET | `/api/v1/users` | USER_VIEW | List users |
| GET | `/api/v1/users/profile` | USER_PROFILE_VIEW | Get own profile |
| PUT | `/api/v1/users/change-password` | USER_CHANGE_PASSWORD | Change password |
| PUT | `/api/v1/users/update-profile` | USER_PROFILE_UPDATE | Update profile |
| POST | `/api/v1/users/{id}/profile-image` | USER_PROFILE_IMAGE_UPLOAD | Upload image |
| PUT | `/api/v1/users/{id}` | USER_UPDATE | Update user |
| DELETE | `/api/v1/users/{id}` | USER_DELETE | Delete user |

### 23. **Organization Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/organizations` | ORGANIZATION_CREATE | Create org |
| GET | `/api/v1/organizations` | ORGANIZATION_VIEW | List orgs |
| GET | `/api/v1/organizations/{id}` | ORGANIZATION_VIEW | Get org by ID |
| PUT | `/api/v1/organizations/{id}` | ORGANIZATION_UPDATE | Update org |
| POST | `/api/v1/organizations/{id}/logo` | ORGANIZATION_LOGO_UPLOAD | Upload logo |
| DELETE | `/api/v1/organizations/{id}` | ORGANIZATION_DELETE | Delete org |

### 24. **Staff Employee Controller** (8 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/staff/employees` | STAFF_EMPLOYEE_VIEW | List employees |
| GET | `/api/v1/staff/employees/{id}` | STAFF_EMPLOYEE_VIEW | Get employee by ID |
| POST | `/api/v1/staff/employees` | STAFF_EMPLOYEE_CREATE | Create employee |
| PUT | `/api/v1/staff/employees/{id}` | STAFF_EMPLOYEE_UPDATE | Update employee |
| DELETE | `/api/v1/staff/employees/{id}` | STAFF_EMPLOYEE_DELETE | Delete employee |
| POST | `/api/v1/staff/employees/{id}/documents` | STAFF_DOCUMENT_UPLOAD | Upload document |
| GET | `/api/v1/staff/employees/{id}/documents` | STAFF_DOCUMENT_VIEW | View documents |
| DELETE | `/api/v1/staff/employees/{id}/documents/{docId}` | STAFF_DOCUMENT_DELETE | Delete document |

### 25. **Staff Attendance Controller** (4 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/staff/attendance` | STAFF_ATTENDANCE_VIEW | Get attendance |
| POST | `/api/v1/staff/attendance` | STAFF_ATTENDANCE_CREATE | Mark attendance |
| PUT | `/api/v1/staff/attendance/{id}` | STAFF_ATTENDANCE_UPDATE | Update attendance |
| GET | `/api/v1/staff/attendance/summary` | STAFF_ATTENDANCE_VIEW | Get summary |

### 26. **Staff Leave Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/staff/leaves` | STAFF_LEAVE_VIEW | Get leaves |
| POST | `/api/v1/staff/leaves` | STAFF_LEAVE_CREATE | Create leave |
| PUT | `/api/v1/staff/leaves/{id}/approve` | STAFF_LEAVE_APPROVE | Approve leave |
| PUT | `/api/v1/staff/leaves/{id}/reject` | STAFF_LEAVE_REJECT | Reject leave |
| PUT | `/api/v1/staff/leaves/{id}/cancel` | STAFF_LEAVE_CANCEL | Cancel leave |
| GET | `/api/v1/staff/leaves/balance` | STAFF_LEAVE_VIEW | Get balance |

### 27. **Staff Payroll Controller** (4 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/staff/payroll` | STAFF_PAYROLL_VIEW | Get payroll |
| POST | `/api/v1/staff/payroll` | STAFF_PAYROLL_CREATE | Generate payroll |
| GET | `/api/v1/staff/payroll/{id}` | STAFF_PAYROLL_VIEW | Get payroll by ID |
| PUT | `/api/v1/staff/payroll/{id}/mark-paid` | STAFF_PAYROLL_UPDATE | Mark paid |

### 28. **Staff Setting Controller** (4 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/staff/settings/{type}` | STAFF_SETTING_VIEW | Get settings |
| POST | `/api/v1/staff/settings/{type}` | STAFF_SETTING_CREATE | Create setting |
| PUT | `/api/v1/staff/settings/{type}/{id}` | STAFF_SETTING_UPDATE | Update setting |
| DELETE | `/api/v1/staff/settings/{type}/{id}` | STAFF_SETTING_DELETE | Delete setting |

### 29. **SMS Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/sms/templates` | SMS_TEMPLATE_VIEW | List templates |
| GET | `/api/v1/sms/templates/{id}` | SMS_TEMPLATE_VIEW | Get template by ID |
| POST | `/api/v1/sms/templates` | SMS_TEMPLATE_CREATE | Create template |
| PUT | `/api/v1/sms/templates/{id}` | SMS_TEMPLATE_UPDATE | Update template |
| DELETE | `/api/v1/sms/templates/{id}` | SMS_TEMPLATE_DELETE | Delete template |
| POST | `/api/v1/sms/send` | SMS_SEND | Send SMS |

### 30. **Email Controller** (6 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/email/templates` | EMAIL_TEMPLATE_VIEW | List templates |
| GET | `/api/v1/email/templates/{id}` | EMAIL_TEMPLATE_VIEW | Get template by ID |
| POST | `/api/v1/email/templates` | EMAIL_TEMPLATE_CREATE | Create template |
| PUT | `/api/v1/email/templates/{id}` | EMAIL_TEMPLATE_UPDATE | Update template |
| DELETE | `/api/v1/email/templates/{id}` | EMAIL_TEMPLATE_DELETE | Delete template |
| POST | `/api/v1/email/send` | EMAIL_SEND | Send email |

### 31. **Report Controller** (11 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/reports/sales` | REPORT_SALES_VIEW | Sales report |
| GET | `/api/v1/reports/purchases` | REPORT_PURCHASE_VIEW | Purchase report |
| GET | `/api/v1/reports/stocks` | REPORT_STOCK_VIEW | Stock report |
| GET | `/api/v1/reports/low-stock` | REPORT_LOW_STOCK_VIEW | Low stock report |
| GET | `/api/v1/reports/customer-ledger/{id}` | REPORT_CUSTOMER_LEDGER_VIEW | Customer ledger |
| GET | `/api/v1/reports/supplier-ledger/{id}` | REPORT_SUPPLIER_LEDGER_VIEW | Supplier ledger |
| GET | `/api/v1/reports/profit-loss` | REPORT_PROFIT_LOSS_VIEW | Profit & loss |
| GET | `/api/v1/reports/gst` | REPORT_GST_VIEW | GST report |
| GET | `/api/v1/reports/inventory-valuation` | REPORT_INVENTORY_VALUATION_VIEW | Inventory valuation |
| GET | `/api/v1/reports/top-selling-items` | REPORT_TOP_SELLING_ITEMS_VIEW | Top selling items |
| GET | `/api/v1/reports/day-book` | REPORT_DAY_BOOK_VIEW | Day book |

### 32. **Dashboard Controller** (1 endpoint)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/dashboard/summary` | DASHBOARD_VIEW | Dashboard summary |

### 33. **Country Controller** (1 endpoint)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/countries` | COUNTRY_VIEW | List countries |

### 34. **State Controller** (1 endpoint)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/states` | STATE_VIEW | Get states by country |

### 35. **Contact Excel Controller** (2 endpoints)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| GET | `/api/v1/contacts/excel/template` | CONTACT_IMPORT | Download template |
| POST | `/api/v1/contacts/excel/import` | CONTACT_IMPORT | Import contacts |

### 36. **Auth Controller** (1 endpoint)
| Method | Endpoint | Permission | Description |
|--------|----------|-----------|-------------|
| POST | `/api/v1/auth/login` | LOGIN | User login |

---

## 📊 Summary

- **Total Controllers**: 37
- **Total Endpoints**: 187+
- **Total Permissions**: 187+
- **Unique Permission Groups**: 32

## 🔍 Usage

Each endpoint is mapped to exactly one permission. Users/roles must have the corresponding permission to access that endpoint.

Example:
- To create an item: Requires `ITEM_CREATE` permission
- To view items: Requires `ITEM_VIEW` permission
- To update an item: Requires `ITEM_UPDATE` permission

---

**Last Updated**: 2026-06-22  
**Version**: 1.0
