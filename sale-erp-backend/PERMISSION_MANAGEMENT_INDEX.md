# Permission Management System - Complete Implementation Guide

## 📋 Table of Contents

1. [Overview](#overview)
2. [Files Created](#files-created)
3. [Quick Start](#quick-start)
4. [Permission Structure](#permission-structure)
5. [All Permissions by Group](#all-permissions-by-group)
6. [Implementation Steps](#implementation-steps)
7. [File References](#file-references)

---

## Overview

A comprehensive permission management system has been created for the Sales ERP Backend. This system:

- ✅ Replaces scattered permission definitions from `application.properties`
- ✅ Centralizes all 187+ permissions in `permissions-config.yaml`
- ✅ Provides automated database population via SQL migration
- ✅ Offers consistent naming and organization
- ✅ Includes complete documentation and quick references

---

## Files Created

### 1. **permissions-config.yaml** 
```
Location: src/main/resources/permissions-config.yaml
Type: YAML Configuration
Size: 22.5 KB
Contains: 187+ permission definitions organized by 32 modules
```

### 2. **V11__insert_permissions.sql**
```
Location: src/main/resources/db/migration/V11__insert_permissions.sql
Type: Flyway Database Migration
Size: 24.7 KB
Contains: INSERT statements for database population
```

### 3. **PERMISSIONS_DOCUMENTATION.md**
```
Location: sale-erp-backend/PERMISSIONS_DOCUMENTATION.md
Type: Complete Reference Guide
Contains: Full documentation, usage instructions, best practices
```

### 4. **PERMISSIONS_QUICK_REFERENCE.md**
```
Location: sale-erp-backend/PERMISSIONS_QUICK_REFERENCE.md
Type: Quick Reference
Contains: Permission names, patterns, and role examples
```

### 5. **PERMISSION_SYSTEM_SUMMARY.md**
```
Location: sale-erp-backend/PERMISSION_SYSTEM_SUMMARY.md
Type: Implementation Summary
Contains: Overview, statistics, and checklist
```

---

## Quick Start

### 1. Configuration File Location
📄 **File**: `src/main/resources/permissions-config.yaml`

### 2. Database Migration
🗄️ **File**: `src/main/resources/db/migration/V11__insert_permissions.sql`

### 3. Run Migration
```bash
mvn flyway:migrate
```

### 4. Verify Permissions Loaded
```sql
SELECT COUNT(*) as total_permissions FROM permissions;
SELECT DISTINCT group_name FROM permissions ORDER BY group_name;
```

---

## Permission Structure

### Format
```yaml
permissions:
  module_key:
    group: "Display Group Name"
    permissions:
      - name: "ENTITY_ACTION"
        description: "Clear description"
        endpoint: "HTTP_METHOD /api/path"
```

### Example
```yaml
permissions:
  brand:
    group: "Brand"
    permissions:
      - name: "BRAND_CREATE"
        description: "Create a new product brand"
        endpoint: "POST /api/v1/brands"
```

### Naming Convention
```
[ENTITY]_[ACTION]

Examples:
BRAND_CREATE       ← Create brand
BRAND_VIEW         ← View/read brands
BRAND_UPDATE       ← Update brand
BRAND_DELETE       ← Delete brand
CUSTOMER_LEDGER_VIEW ← View customer ledger
STAFF_LEAVE_APPROVE ← Approve leave request
```

---

## All Permissions by Group

### 📦 Inventory Management (30 permissions)

**Item (6)**
- ITEM_CREATE, ITEM_VIEW, ITEM_UPDATE, ITEM_DELETE, ITEM_STOCK_VIEW, ITEM_IMPORT

**Category (4)**
- CATEGORY_CREATE, CATEGORY_VIEW, CATEGORY_UPDATE, CATEGORY_DELETE

**Brand (4)**
- BRAND_CREATE, BRAND_VIEW, BRAND_UPDATE, BRAND_DELETE

**Unit (4)**
- UNIT_CREATE, UNIT_VIEW, UNIT_UPDATE, UNIT_DELETE

**Warehouse (4)**
- WAREHOUSE_CREATE, WAREHOUSE_VIEW, WAREHOUSE_UPDATE, WAREHOUSE_DELETE

### 💰 Sales & Purchases (20 permissions)

**Purchase (4)**
- PURCHASE_CREATE, PURCHASE_VIEW, PURCHASE_UPDATE, PURCHASE_DELETE

**Purchase Return (2)**
- PURCHASE_RETURN_CREATE, PURCHASE_RETURN_VIEW

**Sales (5)**
- SALES_CREATE, SALES_VIEW, SALES_UPDATE, SALES_DELETE, SALES_INVOICE_PRINT

**Sales Return (2)**
- SALES_RETURN_CREATE, SALES_RETURN_VIEW

**POS (1)**
- POS_BILLING_CREATE

### 👥 Customer & Supplier (12 permissions)

**Customer (5)**
- CUSTOMER_CREATE, CUSTOMER_VIEW, CUSTOMER_UPDATE, CUSTOMER_DELETE, CUSTOMER_LEDGER_VIEW

**Supplier (5)**
- SUPPLIER_CREATE, SUPPLIER_VIEW, SUPPLIER_UPDATE, SUPPLIER_DELETE, SUPPLIER_LEDGER_VIEW

**Carrier (4)**
- CARRIER_CREATE, CARRIER_VIEW, CARRIER_UPDATE, CARRIER_DELETE

### 💳 Financial Management (20 permissions)

**Payment (4)**
- PAYMENT_IN_CREATE, PAYMENT_IN_VIEW, PAYMENT_OUT_CREATE, PAYMENT_OUT_VIEW

**Bank Account (2)**
- BANK_ACCOUNT_CREATE, BANK_ACCOUNT_VIEW

**Cash (1)**
- CASH_VIEW

**Expense (4)**
- EXPENSE_CREATE, EXPENSE_VIEW, EXPENSE_UPDATE, EXPENSE_DELETE

**Stock (4)**
- STOCK_ADJUSTMENT_CREATE, STOCK_ADJUSTMENT_VIEW, STOCK_TRANSFER_CREATE, STOCK_TRANSFER_VIEW

### 👨‍💼 Staff Management (35 permissions)

**Staff Employee (7)**
- STAFF_EMPLOYEE_CREATE, STAFF_EMPLOYEE_VIEW, STAFF_EMPLOYEE_UPDATE, STAFF_EMPLOYEE_DELETE
- STAFF_DOCUMENT_UPLOAD, STAFF_DOCUMENT_VIEW, STAFF_DOCUMENT_DELETE

**Staff Attendance (3)**
- STAFF_ATTENDANCE_CREATE, STAFF_ATTENDANCE_VIEW, STAFF_ATTENDANCE_UPDATE

**Staff Leave (5)**
- STAFF_LEAVE_CREATE, STAFF_LEAVE_VIEW, STAFF_LEAVE_APPROVE, STAFF_LEAVE_REJECT, STAFF_LEAVE_CANCEL

**Staff Payroll (3)**
- STAFF_PAYROLL_CREATE, STAFF_PAYROLL_VIEW, STAFF_PAYROLL_UPDATE

**Staff Setting (4)**
- STAFF_SETTING_CREATE, STAFF_SETTING_VIEW, STAFF_SETTING_UPDATE, STAFF_SETTING_DELETE

### 💬 Communication (15 permissions)

**SMS (5)**
- SMS_TEMPLATE_CREATE, SMS_TEMPLATE_VIEW, SMS_TEMPLATE_UPDATE, SMS_TEMPLATE_DELETE, SMS_SEND

**Email (5)**
- EMAIL_TEMPLATE_CREATE, EMAIL_TEMPLATE_VIEW, EMAIL_TEMPLATE_UPDATE, EMAIL_TEMPLATE_DELETE, EMAIL_SEND

### 📊 System Management (20 permissions)

**Report (11)**
- REPORT_SALES_VIEW, REPORT_PURCHASE_VIEW, REPORT_STOCK_VIEW, REPORT_LOW_STOCK_VIEW
- REPORT_CUSTOMER_LEDGER_VIEW, REPORT_SUPPLIER_LEDGER_VIEW, REPORT_PROFIT_LOSS_VIEW
- REPORT_GST_VIEW, REPORT_INVENTORY_VALUATION_VIEW, REPORT_TOP_SELLING_ITEMS_VIEW, REPORT_DAY_BOOK_VIEW

**Role (4)**
- ROLE_CREATE, ROLE_VIEW, ROLE_UPDATE, ROLE_DELETE

**User (8)**
- USER_CREATE, USER_VIEW, USER_UPDATE, USER_DELETE
- USER_PROFILE_VIEW, USER_PROFILE_UPDATE, USER_CHANGE_PASSWORD, USER_PROFILE_IMAGE_UPLOAD

**Organization (5)**
- ORGANIZATION_CREATE, ORGANIZATION_VIEW, ORGANIZATION_UPDATE, ORGANIZATION_DELETE, ORGANIZATION_LOGO_UPLOAD

**Dashboard (1)**
- DASHBOARD_VIEW

**Location (2)**
- COUNTRY_VIEW, STATE_VIEW

**Contact Import (1)**
- CONTACT_IMPORT

**Authentication (1)**
- LOGIN

---

## Implementation Steps

### Step 1: Review Configuration
```bash
cat src/main/resources/permissions-config.yaml
```

### Step 2: Check SQL Migration
```bash
cat src/main/resources/db/migration/V11__insert_permissions.sql
```

### Step 3: Run Migration
```bash
mvn clean compile flyway:migrate
```

### Step 4: Verify in Database
```sql
-- Check total permissions
SELECT COUNT(*) as total_permissions FROM permissions;

-- View all permission groups
SELECT DISTINCT group_name FROM permissions ORDER BY group_name;

-- Check specific module permissions
SELECT * FROM permissions WHERE group_name = 'Brand';
```

### Step 5: Assign to Roles

**Example 1: Admin Role**
```sql
-- Assign ALL permissions to Admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Admin'
AND p.status = 'ACTIVE'
AND p.is_deleted = FALSE;
```

**Example 2: Manager Role**
```sql
-- Assign business-critical permissions to Manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Manager'
AND p.group_name IN ('Item', 'Category', 'Brand', 'Customer', 'Supplier', 
                     'Purchase', 'Sales', 'Payment', 'Expense', 'Report', 'Dashboard')
AND p.status = 'ACTIVE';
```

**Example 3: Sales Executive Role**
```sql
-- Assign sales-related permissions to Sales Executive
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Sales Executive'
AND p.group_name IN ('Customer', 'Sales', 'Sales Return', 'Payment', 'Report', 'Dashboard')
AND p.name NOT LIKE '%DELETE%'
AND p.status = 'ACTIVE';
```

**Example 4: Inventory Staff Role**
```sql
-- Assign inventory-related permissions to Inventory Staff
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'Inventory Staff'
AND p.group_name IN ('Item', 'Category', 'Brand', 'Unit', 'Warehouse', 
                     'Purchase', 'Stock', 'Report')
AND p.name NOT LIKE '%DELETE%'
AND p.status = 'ACTIVE';
```

---

## File References

### 📄 Documentation Files

| File | Purpose | Quick Start |
|------|---------|-------------|
| **PERMISSIONS_DOCUMENTATION.md** | Complete implementation guide | Read first for overview |
| **PERMISSIONS_QUICK_REFERENCE.md** | Quick lookup for permission names | Use for finding permission names |
| **PERMISSION_SYSTEM_SUMMARY.md** | Implementation summary | For project overview |
| **README.md** (This File) | Index and quick start | Start here |

### ⚙️ Configuration Files

| File | Purpose | Format |
|------|---------|--------|
| **permissions-config.yaml** | Permission definitions | YAML |
| **V11__insert_permissions.sql** | Database migration | SQL |

### 📋 Database Tables

```sql
-- Permissions Table
CREATE TABLE permissions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    group_name VARCHAR(50) NOT NULL,
    description VARCHAR(500),
    endpoint VARCHAR(200),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Role Permissions Association Table
CREATE TABLE role_permissions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id),
    UNIQUE KEY unique_role_permission (role_id, permission_id)
);
```

---

## Statistics

```
Total Permissions: 187+
Permission Groups: 32 modules
Controllers Covered: 37 API controllers
API Endpoints: 187+ REST endpoints
Flyway Migrations: 1 (V001)
```

---

## Key Features

✅ **Centralized Configuration** - All permissions in one YAML file
✅ **Standard Naming** - Consistent [ENTITY]_[ACTION] format
✅ **Organized by Module** - Logical grouping for easy assignment
✅ **Database Driven** - SQL migration for version control
✅ **Complete Documentation** - Reference guides and examples
✅ **Role Templates** - Pre-made role assignment queries
✅ **Best Practices** - Security and maintenance guidelines

---

## Common Tasks

### Add New Permission
1. Edit `permissions-config.yaml`
2. Add to SQL migration or new migration file
3. Run migration

### Create New Role
1. Create role in roles table
2. Execute role_permissions INSERT query
3. Assign to users

### Check User Permissions
```sql
SELECT DISTINCT p.name, p.group_name, p.description
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE u.id = ?
ORDER BY p.group_name, p.name;
```

---

## Support & Questions

For more detailed information:
- 📖 Read `PERMISSIONS_DOCUMENTATION.md` for complete guide
- 🔍 Check `PERMISSIONS_QUICK_REFERENCE.md` for permission names
- 📊 View `PERMISSION_SYSTEM_SUMMARY.md` for statistics
- 🎯 Review `permissions-config.yaml` for definitions
- 💾 Check `V11__insert_permissions.sql` for database schema

---

## Migration Checklist

- [ ] Review `permissions-config.yaml` file
- [ ] Verify `V11__insert_permissions.sql` migration script
- [ ] Run Flyway migration: `mvn flyway:migrate`
- [ ] Verify permissions loaded: `SELECT COUNT(*) FROM permissions;`
- [ ] Create role-permission associations
- [ ] Assign roles to users
- [ ] Test permission enforcement
- [ ] Document custom permissions added

---

## Best Practices

1. ✅ Always use `[ENTITY]_[ACTION]` naming format
2. ✅ Group related permissions by module
3. ✅ Provide clear descriptions for each permission
4. ✅ Use Flyway for version-controlled migrations
5. ✅ Soft delete unused permissions (don't hard delete)
6. ✅ Review permissions quarterly
7. ✅ Follow principle of least privilege for role assignment
8. ✅ Document custom permissions added to system

---

**Version**: 1.0  
**Created**: 2026-06-22  
**Status**: Ready for Implementation  
**Maintained By**: Development Team
