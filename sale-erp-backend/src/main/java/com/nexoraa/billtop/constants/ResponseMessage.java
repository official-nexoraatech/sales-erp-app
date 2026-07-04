package com.nexoraa.billtop.constants;

/**
 * Response message constants for API responses.
 */
public class ResponseMessage {

    private ResponseMessage() {
    }

    // Auth Messages
    public static final String LOGIN_SUCCESS = "Login successful";
    public static final String REGISTER_SUCCESS = "User registered successfully";
    public static final String LOGOUT_SUCCESS = "Logout successful";

    // Organization Messages
    public static final String ORGANIZATION_CREATED = "Organization created successfully";
    public static final String ORGANIZATION_UPDATED = "Organization updated successfully";
    public static final String ORGANIZATION_DELETED = "Organization deleted successfully";
    public static final String ORGANIZATION_RETRIEVED = "Organization retrieved successfully";
    public static final String ORGANIZATIONS_RETRIEVED = "Organizations retrieved successfully";
    public static final String ORGANIZATION_LOGO_UPLOADED = "Organization logo uploaded successfully";

    // Item Messages
    public static final String ITEM_CREATED = "Item created successfully";
    public static final String ITEM_UPDATED = "Item updated successfully";
    public static final String ITEM_DELETED = "Item deleted successfully";
    public static final String ITEMS_RETRIEVED = "Items retrieved successfully";
    public static final String ITEM_RETRIEVED = "Item retrieved successfully";
    public static final String ITEM_STOCK_RETRIEVED = "Item stock retrieved successfully";

    // Customer Messages
    public static final String CUSTOMER_CREATED = "Customer created successfully";
    public static final String CUSTOMER_UPDATED = "Customer updated successfully";
    public static final String CUSTOMER_DELETED = "Customer deleted successfully";
    public static final String CUSTOMER_RETRIEVED = "Customer retrieved successfully";
    public static final String CUSTOMERS_RETRIEVED = "Customers retrieved successfully";
    public static final String CUSTOMER_LEDGER_RETRIEVED = "Customer ledger retrieved successfully";

    // Supplier Messages
    public static final String SUPPLIER_CREATED = "Supplier created successfully";
    public static final String SUPPLIER_UPDATED = "Supplier updated successfully";
    public static final String SUPPLIER_DELETED = "Supplier deleted successfully";
    public static final String SUPPLIER_RETRIEVED = "Supplier retrieved successfully";
    public static final String SUPPLIERS_RETRIEVED = "Suppliers retrieved successfully";
    public static final String SUPPLIER_LEDGER_RETRIEVED = "Supplier ledger retrieved successfully";

    // Carrier Messages
    public static final String CARRIER_CREATED = "Carrier created successfully";
    public static final String CARRIER_UPDATED = "Carrier updated successfully";
    public static final String CARRIER_DELETED = "Carrier deleted successfully";
    public static final String CARRIER_RETRIEVED = "Carrier retrieved successfully";
    public static final String CARRIERS_RETRIEVED = "Carriers retrieved successfully";

    // Category Messages
    public static final String CATEGORY_CREATED = "Category created successfully";
    public static final String CATEGORY_UPDATED = "Category updated successfully";
    public static final String CATEGORY_DELETED = "Category deleted successfully";
    public static final String CATEGORIES_RETRIEVED = "Categories retrieved successfully";

    // Brand Messages
    public static final String BRAND_CREATED = "Brand created successfully";
    public static final String BRAND_UPDATED = "Brand updated successfully";
    public static final String BRAND_DELETED = "Brand deleted successfully";
    public static final String BRANDS_RETRIEVED = "Brands retrieved successfully";

    // Unit Messages
    public static final String UNIT_CREATED = "Unit created successfully";
    public static final String UNIT_UPDATED = "Unit updated successfully";
    public static final String UNIT_DELETED = "Unit deleted successfully";
    public static final String UNITS_RETRIEVED = "Units retrieved successfully";
    public static final String UNIT_RETRIEVED = "Unit retrieved successfully";

    // Warehouse Messages
    public static final String WAREHOUSE_CREATED = "Warehouse created successfully";
    public static final String WAREHOUSE_UPDATED = "Warehouse updated successfully";
    public static final String WAREHOUSE_DELETED = "Warehouse deleted successfully";
    public static final String WAREHOUSE_RETRIEVED = "Warehouse retrieved successfully";
    public static final String WAREHOUSES_RETRIEVED = "Warehouses retrieved successfully";

    // Location Messages
    public static final String COUNTRIES_RETRIEVED = "Countries retrieved successfully";
    public static final String STATES_RETRIEVED = "States retrieved successfully";

    // Purchase Messages
    public static final String PURCHASE_CREATED = "Purchase created successfully";
    public static final String PURCHASE_UPDATED = "Purchase updated successfully";
    public static final String PURCHASE_CANCELLED = "Purchase cancelled successfully";
    public static final String PURCHASE_DELETED = "Purchase deleted successfully";
    public static final String PURCHASE_RETRIEVED = "Purchase retrieved successfully";
    public static final String PURCHASES_RETRIEVED = "Purchases retrieved successfully";

    // Purchase Return Messages
    public static final String PURCHASE_RETURN_CREATED = "Purchase return created successfully";
    public static final String PURCHASE_RETURN_RETRIEVED = "Purchase return retrieved successfully";
    public static final String PURCHASE_RETURNS_RETRIEVED = "Purchase returns retrieved successfully";

    // Sales Messages
    public static final String SALES_INVOICE_CREATED = "Sales invoice created successfully";
    public static final String SALES_INVOICE_UPDATED = "Sales invoice updated successfully";
    public static final String SALES_INVOICE_CANCELLED = "Sales invoice cancelled successfully";
    public static final String SALES_INVOICE_DELETED = "Sales invoice deleted successfully";
    public static final String SALES_INVOICE_RETRIEVED = "Sales invoice retrieved successfully";
    public static final String SALES_INVOICES_RETRIEVED = "Sales invoices retrieved successfully";
    public static final String SALES_INVOICE_PRINT_RETRIEVED = "Sales invoice retrieved successfully";
    public static final String QUOTATION_CREATED = "Quotation created successfully";
    public static final String QUOTATION_UPDATED = "Quotation updated successfully";
    public static final String QUOTATION_DELETED = "Quotation deleted successfully";
    public static final String QUOTATION_RETRIEVED = "Quotation retrieved successfully";
    public static final String QUOTATIONS_RETRIEVED = "Quotations retrieved successfully";
    public static final String QUOTATION_CONVERTED = "Quotation converted to invoice successfully";

    // Sales Return Messages
    public static final String SALES_RETURN_CREATED = "Sales return created successfully";
    public static final String SALES_RETURN_RETRIEVED = "Sales return retrieved successfully";
    public static final String SALES_RETURNS_RETRIEVED = "Sales returns retrieved successfully";

    // POS Messages
    public static final String POS_BILL_GENERATED = "POS Bill Generated Successfully";

    // Payment Messages
    public static final String PAYMENT_RECEIVED = "Payment received successfully";
    public static final String PAYMENT_MADE = "Payment made successfully";
    public static final String PAYMENTS_RETRIEVED = "Payments retrieved successfully";
    public static final String PAYMENT_RETRIEVED = "Payment retrieved successfully";
    public static final String PAYMENT_IN_UPDATED = "Payment in updated successfully";
    public static final String PAYMENT_IN_DELETED = "Payment in deleted successfully";
    public static final String PAYMENT_OUT_UPDATED = "Payment out updated successfully";
    public static final String PAYMENT_OUT_DELETED = "Payment out deleted successfully";

    // Stock Movement Messages
    public static final String STOCK_ADJUSTMENT_COMPLETED = "Stock adjustment completed";
    public static final String STOCK_ADJUSTMENT_UPDATED = "Stock adjustment updated successfully";
    public static final String STOCK_ADJUSTMENT_DELETED = "Stock adjustment deleted successfully";
    public static final String STOCK_ADJUSTMENTS_RETRIEVED = "Stock adjustments retrieved successfully";
    public static final String STOCK_ADJUSTMENT_RETRIEVED = "Stock adjustment retrieved successfully";
    public static final String STOCK_TRANSFERRED = "Stock transferred successfully";
    public static final String STOCK_TRANSFER_UPDATED = "Stock transfer updated successfully";
    public static final String STOCK_TRANSFER_DELETED = "Stock transfer deleted successfully";
    public static final String STOCK_TRANSFERS_RETRIEVED = "Stock transfers retrieved successfully";
    public static final String STOCK_TRANSFER_RETRIEVED = "Stock transfer retrieved successfully";

    // Expense Messages
    public static final String EXPENSE_CREATED = "Expense created successfully";
    public static final String EXPENSE_UPDATED = "Expense updated successfully";
    public static final String EXPENSE_DELETED = "Expense deleted successfully";
    public static final String EXPENSES_RETRIEVED = "Expenses retrieved successfully";
    public static final String EXPENSE_RETRIEVED = "Expense retrieved successfully";
    public static final String EXPENSE_CATEGORY_CREATED = "Expense category created successfully";
    public static final String EXPENSE_CATEGORY_UPDATED = "Expense category updated successfully";
    public static final String EXPENSE_CATEGORY_DELETED = "Expense category deleted successfully";
    public static final String EXPENSE_CATEGORY_RETRIEVED = "Expense category retrieved successfully";
    public static final String EXPENSE_CATEGORIES_RETRIEVED = "Expense categories retrieved successfully";
    public static final String EXPENSE_SUB_CATEGORY_CREATED = "Expense sub category created successfully";
    public static final String EXPENSE_SUB_CATEGORY_UPDATED = "Expense sub category updated successfully";
    public static final String EXPENSE_SUB_CATEGORY_DELETED = "Expense sub category deleted successfully";
    public static final String EXPENSE_SUB_CATEGORY_RETRIEVED = "Expense sub category retrieved successfully";
    public static final String EXPENSE_SUB_CATEGORIES_RETRIEVED = "Expense sub categories retrieved successfully";

    // Bank/Cash Messages
    public static final String BANK_ACCOUNT_CREATED = "Bank account created successfully";
    public static final String BANK_ACCOUNTS_RETRIEVED = "Bank accounts retrieved successfully";
    public static final String BANK_TRANSACTIONS_RETRIEVED = "Bank transactions retrieved successfully";
    public static final String CASH_SUMMARY_RETRIEVED = "Cash summary retrieved successfully";
    public static final String CASH_TRANSACTIONS_RETRIEVED = "Cash transactions retrieved successfully";
    public static final String PAYMENT_METHOD_CREATED = "Payment method created successfully";
    public static final String PAYMENT_METHOD_UPDATED = "Payment method updated successfully";
    public static final String PAYMENT_METHOD_DELETED = "Payment method deleted successfully";
    public static final String PAYMENT_METHOD_RETRIEVED = "Payment method retrieved successfully";
    public static final String PAYMENT_METHODS_RETRIEVED = "Payment methods retrieved successfully";

    // Dashboard/Report Messages
    public static final String DASHBOARD_SUMMARY_RETRIEVED = "Dashboard summary retrieved successfully";
    public static final String REPORT_RETRIEVED = "Report retrieved successfully";

    // Role Messages
    public static final String ROLE_CREATED = "Role created successfully";
    public static final String ROLE_UPDATED = "Role updated successfully";
    public static final String ROLE_DELETED = "Role deleted successfully";
    public static final String ROLE_RETRIEVED = "Role retrieved successfully";
    public static final String ROLES_RETRIEVED = "Roles retrieved successfully";

    // User Messages
    public static final String USER_CREATED = "User created successfully";
    public static final String USER_UPDATED = "User updated successfully";
    public static final String USER_DELETED = "User deleted successfully";
    public static final String USER_RETRIEVED = "User retrieved successfully";
    public static final String USERS_RETRIEVED = "Users retrieved successfully";
    public static final String PASSWORD_CHANGED = "Password changed successfully";
    public static final String PROFILE_UPDATED = "Profile updated successfully";
    public static final String PROFILE_RETRIEVED = "Profile retrieved successfully";
    public static final String PROFILE_IMAGE_UPLOADED = "Profile image uploaded successfully";

    // Permission Messages
    public static final String PERMISSIONS_RETRIEVED = "Permissions retrieved successfully";
    public static final String USER_PERMISSIONS_RETRIEVED = "User permissions retrieved successfully";
    public static final String USER_PERMISSIONS_ASSIGNED = "User permissions assigned successfully";

    // SMS Messages
    public static final String SMS_TEMPLATE_CREATED = "SMS template created successfully";
    public static final String SMS_TEMPLATE_UPDATED = "SMS template updated successfully";
    public static final String SMS_TEMPLATE_DELETED = "SMS template deleted successfully";
    public static final String SMS_TEMPLATE_RETRIEVED = "SMS template retrieved successfully";
    public static final String SMS_TEMPLATES_RETRIEVED = "SMS templates retrieved successfully";
    public static final String SMS_SENT = "SMS sent successfully";

    // Email Messages
    public static final String EMAIL_TEMPLATE_CREATED = "Email template created successfully";
    public static final String EMAIL_TEMPLATE_UPDATED = "Email template updated successfully";
    public static final String EMAIL_TEMPLATE_DELETED = "Email template deleted successfully";
    public static final String EMAIL_TEMPLATE_RETRIEVED = "Email template retrieved successfully";
    public static final String EMAIL_TEMPLATES_RETRIEVED = "Email templates retrieved successfully";
    public static final String EMAIL_SENT = "Email sent successfully";

    // Staff Messages
    public static final String STAFF_EMPLOYEE_CREATED = "Employee created successfully";
    public static final String STAFF_EMPLOYEE_UPDATED = "Employee updated successfully";
    public static final String STAFF_EMPLOYEE_DELETED = "Employee deleted successfully";
    public static final String STAFF_EMPLOYEE_RETRIEVED = "Employee retrieved successfully";
    public static final String STAFF_EMPLOYEES_RETRIEVED = "Employees retrieved successfully";
    public static final String STAFF_ATTENDANCE_RETRIEVED = "Attendance records retrieved successfully";
    public static final String STAFF_ATTENDANCE_MARKED = "Attendance marked successfully";
    public static final String STAFF_ATTENDANCE_UPDATED = "Attendance updated successfully";
    public static final String STAFF_ATTENDANCE_SUMMARY_RETRIEVED = "Attendance summary retrieved successfully";
    public static final String STAFF_LEAVE_CREATED = "Leave request created successfully";
    public static final String STAFF_LEAVES_RETRIEVED = "Leave requests retrieved successfully";
    public static final String STAFF_LEAVE_APPROVED = "Leave request approved successfully";
    public static final String STAFF_LEAVE_REJECTED = "Leave request rejected successfully";
    public static final String STAFF_LEAVE_CANCELLED = "Leave request cancelled successfully";
    public static final String STAFF_LEAVE_BALANCE_RETRIEVED = "Leave balance retrieved successfully";
    public static final String STAFF_PAYROLL_GENERATED = "Payroll generated successfully";
    public static final String STAFF_PAYROLL_RETRIEVED = "Payroll retrieved successfully";
    public static final String STAFF_PAYROLLS_RETRIEVED = "Payroll records retrieved successfully";
    public static final String STAFF_PAYROLL_MARKED_PAID = "Payroll marked paid successfully";
    public static final String STAFF_SETTING_CREATED = "Staff setting created successfully";
    public static final String STAFF_SETTING_UPDATED = "Staff setting updated successfully";
    public static final String STAFF_SETTING_DELETED = "Staff setting deleted successfully";
    public static final String STAFF_SETTINGS_RETRIEVED = "Staff settings retrieved successfully";
    public static final String STAFF_DOCUMENT_UPLOADED = "Employee document uploaded successfully";
    public static final String STAFF_DOCUMENTS_RETRIEVED = "Employee documents retrieved successfully";
    public static final String STAFF_DOCUMENT_DELETED = "Employee document deleted successfully";
}

