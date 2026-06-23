# Permission Management System Documentation

## Overview

This document describes the permission configuration system for the Sales ERP Backend. All API permissions are now centrally managed in the `permissions-config.yaml` file instead of being scattered across the `application.properties` file.

## Files Structure

### 1. **permissions-config.yaml** 
   - **Location**: `src/main/resources/permissions-config.yaml`
   - **Purpose**: Central configuration for all API permissions
   - **Format**: YAML
   - Contains: All permission definitions organized by module/group

### 2. **V11__insert_permissions.sql**
   - **Location**: `src/main/resources/db/migration/V11__insert_permissions.sql`
   - **Purpose**: Flyway migration script to populate the permissions table
   - **Usage**: Automatically runs on application startup
   - Contains: INSERT statements for all permissions

## Permission Structure

Each permission is defined with the following attributes:

```yaml
permissions:
  category_name:
    group: "Display Group Name"
    permissions:
      - name: "PERMISSION_NAME"           # Unique identifier for the permission
        description: "Short description"    # Human-readable description
        endpoint: "METHOD /api/path"        # API endpoint(s)
```

### Permission Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | Unique identifier (e.g., `BRAND_CREATE`) |
| `group_name` | String | Permission group for organization (e.g., `Brand`) |
| `description` | String | Clear description of what this permission allows |
| `endpoint` | String | Associated API endpoint(s) |
| `status` | String | Permission status (ACTIVE/INACTIVE) |
| `is_deleted` | Boolean | Soft delete flag |

## Permission Naming Convention

Permissions follow a consistent naming pattern:

```
[ENTITY]_[ACTION]
```

**Examples:**
- `BRAND_CREATE` - Create brand
- `BRAND_VIEW` - View brands
- `BRAND_UPDATE` - Update brand
- `BRAND_DELETE` - Delete brand
- `CUSTOMER_LEDGER_VIEW` - View customer ledger

**Common Actions:**
- `CREATE` - Create new records
- `VIEW` - Read/retrieve records
- `UPDATE` - Modify existing records
- `DELETE` - Remove records
- `IMPORT` - Import data from file
- `APPROVE` - Approve requests
- `REJECT` - Reject requests
- `CANCEL` - Cancel operations

## Permission Groups (Modules)

The system organizes permissions into the following groups:

| Group | Permissions | Example |
|-------|------------|---------|
| **Item** | Create, View, Update, Delete, Stock View, Import | ITEM_CREATE |
| **Category** | Create, View, Update, Delete | CATEGORY_CREATE |
| **Brand** | Create, View, Update, Delete | BRAND_CREATE |
| **Unit** | Create, View, Update, Delete | UNIT_CREATE |
| **Warehouse** | Create, View, Update, Delete | WAREHOUSE_CREATE |
| **Customer** | Create, View, Update, Delete, Ledger | CUSTOMER_CREATE |
| **Supplier** | Create, View, Update, Delete, Ledger | SUPPLIER_CREATE |
| **Carrier** | Create, View, Update, Delete | CARRIER_CREATE |
| **Purchase** | Create, View, Update, Delete (Cancel) | PURCHASE_CREATE |
| **Purchase Return** | Create, View | PURCHASE_RETURN_CREATE |
| **Sales** | Create, View, Update, Delete (Cancel), Print | SALES_CREATE |
| **Sales Return** | Create, View | SALES_RETURN_CREATE |
| **Payment** | In (Create, View), Out (Create, View) | PAYMENT_IN_CREATE |
| **Bank Account** | Create, View | BANK_ACCOUNT_CREATE |
| **Cash** | View | CASH_VIEW |
| **Expense** | Create, View, Update, Delete | EXPENSE_CREATE |
| **Stock** | Adjustment (Create, View), Transfer (Create, View) | STOCK_ADJUSTMENT_CREATE |
| **POS** | Billing Create | POS_BILLING_CREATE |
| **Role** | Create, View, Update, Delete | ROLE_CREATE |
| **User** | Create, View, Update, Delete, Profile, Password | USER_CREATE |
| **Organization** | Create, View, Update, Delete, Logo Upload | ORGANIZATION_CREATE |
| **Staff Employee** | Create, View, Update, Delete, Documents | STAFF_EMPLOYEE_CREATE |
| **Staff Attendance** | Create, View, Update | STAFF_ATTENDANCE_CREATE |
| **Staff Leave** | Create, View, Approve, Reject, Cancel | STAFF_LEAVE_CREATE |
| **Staff Payroll** | Create, View, Update (Mark Paid) | STAFF_PAYROLL_CREATE |
| **Staff Setting** | Create, View, Update, Delete | STAFF_SETTING_CREATE |
| **SMS** | Template (Create, View, Update, Delete), Send | SMS_TEMPLATE_CREATE |
| **Email** | Template (Create, View, Update, Delete), Send | EMAIL_TEMPLATE_CREATE |
| **Report** | Sales, Purchase, Stock, Low Stock, Ledgers, P&L, GST, Inventory, Top Items, Day Book | REPORT_SALES_VIEW |
| **Dashboard** | View Summary | DASHBOARD_VIEW |
| **Location** | Country View, State View | COUNTRY_VIEW |
| **Contact Import** | Import | CONTACT_IMPORT |
| **Authentication** | Login | LOGIN |

## Total Permissions

**Total Permissions in System: 187+**

### Breakdown by Category:
- Inventory Management: 30+
- Sales & Purchases: 15+
- Customer & Supplier: 12+
- Financial: 20+
- Staff Management: 35+
- Communication: 10+
- User & Organization: 20+
- Reports: 11+
- Others: 14+

## Usage Instructions

### For Developers

1. **Adding New Permission**:
   ```yaml
   # In permissions-config.yaml
   permissions:
     new_module:
       group: "Module Name"
       permissions:
         - name: "MODULE_ACTION"
           description: "Clear description"
           endpoint: "GET /api/v1/new-endpoint"
   ```

2. **Adding SQL Migration**:
   ```sql
   INSERT INTO permissions (name, group_name, description, endpoint, status, is_deleted, created_at, updated_at) VALUES
   ('MODULE_ACTION', 'Module Name', 'Clear description', 'GET /api/v1/new-endpoint', 'ACTIVE', FALSE, NOW(), NOW());
   ```

### For DBAs

1. **Running Migration**:
   ```bash
   mvn flyway:migrate
   ```

2. **Verifying Permissions**:
   ```sql
   SELECT * FROM permissions WHERE group_name = 'Brand';
   ```

3. **Assigning Permissions to Role**:
   ```sql
   INSERT INTO role_permissions (role_id, permission_id) 
   SELECT r.id, p.id FROM roles r, permissions p 
   WHERE r.name = 'Admin' AND p.group_name = 'Item';
   ```

## Database Schema (Permissions Table)

```sql
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

## API Endpoints Covered

### Inventory Management (30 endpoints)
- Items: Create, Read, Update, Delete, Stock View, Import
- Categories: Create, Read, Update, Delete
- Brands: Create, Read, Update, Delete
- Units: Create, Read, Update, Delete
- Warehouses: Create, Read, Update, Delete

### Sales & Purchases (20+ endpoints)
- Purchases: Create, Read, Update, Cancel
- Purchase Returns: Create, Read
- Sales: Create, Read, Update, Cancel, Print Invoice
- Sales Returns: Create, Read

### Customer & Supplier (12+ endpoints)
- Customers: Create, Read, Update, Delete, Ledger
- Suppliers: Create, Read, Update, Delete, Ledger
- Carriers: Create, Read, Update, Delete

### Financial (20+ endpoints)
- Payments (In/Out): Create, Read
- Bank Accounts: Create, Read
- Cash: View Summary and Transactions
- Expenses: Create, Read, Update, Delete
- Stock Adjustments & Transfers: Create, Read

### Staff Management (35+ endpoints)
- Employees: Create, Read, Update, Delete, Documents
- Attendance: Mark, View, Update
- Leaves: Create, View, Approve, Reject, Cancel
- Payroll: Generate, View, Mark Paid
- Settings: Create, View, Update, Delete

### Communication (15 endpoints)
- SMS: Templates (CRUD), Send
- Email: Templates (CRUD), Send

### Reports (11 endpoints)
- Sales, Purchases, Stock, Low Stock
- Customer/Supplier Ledgers
- Profit & Loss, GST
- Inventory Valuation
- Top Selling Items, Day Book

## Migration Strategy

1. **Phase 1**: Load all permissions via SQL migration
2. **Phase 2**: Create role-permission associations
3. **Phase 3**: Assign roles to users
4. **Phase 4**: Test permission enforcement

## Best Practices

1. ✅ **Use Consistent Naming**: Follow `[ENTITY]_[ACTION]` pattern
2. ✅ **Group Related Permissions**: Organize by module/entity
3. ✅ **Document Clearly**: Provide clear descriptions
4. ✅ **Version Migrations**: Use Flyway versioning
5. ✅ **Soft Delete**: Mark unused permissions as deleted
6. ✅ **Regular Reviews**: Audit and update permissions quarterly

## Troubleshooting

### Permission Not Found
- Check `permissions-config.yaml` for typos
- Verify SQL migration ran successfully
- Query database: `SELECT * FROM permissions WHERE name = 'XXXX';`

### Permission Not Assigned to Role
- Verify role-permission association exists
- Check `role_permissions` table
- Ensure role is ACTIVE

### Permission Assignment Not Working
- Verify user-role association
- Check role status (must be ACTIVE)
- Review security configuration

## References

- Configuration File: `src/main/resources/permissions-config.yaml`
- SQL Migration: `src/main/resources/db/migration/V11__insert_permissions.sql`
- Security Configuration: `src/main/java/com/nexoraa/billtop/security/`
- Controller Mappings: `src/main/java/com/nexoraa/billtop/controller/`

---

**Last Updated**: 2026-06-22
**Version**: 1.0
**Maintained By**: Development Team
