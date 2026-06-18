package com.nexoraa.billtop.constants;

/**
 * Error message constants for API error responses.
 */
public class ErrorMessage {

    private ErrorMessage() {
    }

    // Authentication Errors
    public static final String INVALID_CREDENTIALS = "Invalid username or password";
    public static final String UNAUTHORIZED = "Unauthorized access";
    public static final String TOKEN_INVALID = "Invalid or expired token";
    public static final String TOKEN_EXPIRED = "Token has expired";
    public static final String USER_NOT_FOUND = "User not found";
    public static final String USER_ALREADY_EXISTS = "User already exists";
    public static final String CURRENT_PASSWORD_INVALID = "Current password is incorrect";
    public static final String FORBIDDEN = "Access forbidden - insufficient permissions";

    // Organization Errors
    public static final String ORGANIZATION_NOT_FOUND = "Organization not found";
    public static final String ORGANIZATION_ALREADY_EXISTS = "Organization already exists";

    // Item Errors
    public static final String ITEM_NOT_FOUND = "Item not found";
    public static final String ITEM_ALREADY_EXISTS = "Item already exists";

    // Customer Errors
    public static final String CUSTOMER_NOT_FOUND = "Customer not found";

    // Supplier Errors
    public static final String SUPPLIER_NOT_FOUND = "Supplier not found";

    // Category Errors
    public static final String CATEGORY_NOT_FOUND = "Category not found";
    public static final String CATEGORY_ALREADY_EXISTS = "Category already exists";

    // Brand Errors
    public static final String BRAND_NOT_FOUND = "Brand not found";
    public static final String BRAND_ALREADY_EXISTS = "Brand already exists";

    // Unit Errors
    public static final String UNIT_NOT_FOUND = "Unit not found";
    public static final String UNIT_ALREADY_EXISTS = "Unit already exists";

    // Warehouse Errors
    public static final String WAREHOUSE_NOT_FOUND = "Warehouse not found";
    public static final String WAREHOUSE_ALREADY_EXISTS = "Warehouse already exists";

    // Carrier Errors
    public static final String CARRIER_ALREADY_EXISTS = "Carrier already exists";

    // Location Errors
    public static final String COUNTRY_NOT_FOUND = "Country not found";
    public static final String STATE_NOT_FOUND = "State not found";

    // Inventory Related Errors
    public static final String CATEGORY_REQUIRED = "Category is required";
    public static final String BRAND_REQUIRED = "Brand is required";
    public static final String BASE_UNIT_REQUIRED = "Base unit is required";
    public static final String WAREHOUSE_REQUIRED = "Warehouse is required";
    public static final String SHIPPING_CARRIER_NOT_FOUND = "Shipping carrier not found";
    public static final String PAYMENT_METHOD_NOT_FOUND = "Payment method not found";
    public static final String INSUFFICIENT_STOCK = "Insufficient stock";

    // Purchase/Sales Errors
    public static final String PURCHASE_NOT_FOUND = "Purchase not found";
    public static final String PURCHASE_RETURN_NOT_FOUND = "Purchase return not found";
    public static final String SALE_NOT_FOUND = "Sales invoice not found";
    public static final String SALES_RETURN_NOT_FOUND = "Sales return not found";
    public static final String PURCHASE_ALREADY_CANCELLED = "Purchase is already cancelled";
    public static final String SALE_ALREADY_CANCELLED = "Sales invoice is already cancelled";

    // Role Errors
    public static final String ROLE_NOT_FOUND = "Role not found";
    public static final String ROLE_ALREADY_EXISTS = "Role already exists";

    // Permission Errors
    public static final String PERMISSION_NOT_FOUND = "Permission not found";
    public static final String PERMISSION_ALREADY_EXISTS = "Permission already exists";

    // SMS Errors
    public static final String SMS_TEMPLATE_NOT_FOUND = "SMS template not found";
    public static final String SMS_TEMPLATE_ALREADY_EXISTS = "SMS template already exists";
    public static final String INVALID_MOBILE_NUMBERS = "One or more mobile numbers are invalid";
    public static final String SMS_SEND_FAILED = "SMS send failed";

    // Email Errors
    public static final String EMAIL_TEMPLATE_NOT_FOUND = "Email template not found";
    public static final String EMAIL_TEMPLATE_ALREADY_EXISTS = "Email template already exists";
    public static final String INVALID_EMAIL_IDS = "One or more email IDs are invalid";
    public static final String EMAIL_SEND_FAILED = "Email send failed";

    // Staff Errors
    public static final String STAFF_EMPLOYEE_NOT_FOUND = "Employee not found";
    public static final String STAFF_EMPLOYEE_ALREADY_EXISTS = "Employee already exists";
    public static final String STAFF_ATTENDANCE_NOT_FOUND = "Attendance record not found";
    public static final String STAFF_ATTENDANCE_ALREADY_EXISTS = "Attendance record already exists";
    public static final String STAFF_LEAVE_NOT_FOUND = "Leave request not found";
    public static final String STAFF_PAYROLL_NOT_FOUND = "Payroll record not found";
    public static final String STAFF_SETTING_NOT_FOUND = "Staff setting not found";
    public static final String STAFF_SETTING_ALREADY_EXISTS = "Staff setting already exists";
    public static final String STAFF_DOCUMENT_NOT_FOUND = "Employee document not found";
    public static final String INVALID_STAFF_SETTING_TYPE = "Invalid staff setting type";
    public static final String INVALID_STATUS = "Invalid status";
    public static final String INVALID_DATE = "Invalid date";
    public static final String INVALID_MONTH = "Invalid month";
    public static final String INVALID_YEAR = "Invalid year";

    // General Errors
    public static final String BAD_REQUEST = "Bad request";
    public static final String FILE_REQUIRED = "File is required";
    public static final String INVALID_IMAGE_FILE = "Only JPEG, PNG, or WebP image files are allowed";
    public static final String FILE_SIZE_EXCEEDED = "File size exceeds allowed limit";
    public static final String FILE_UPLOAD_FAILED = "File upload failed";
    public static final String INTERNAL_SERVER_ERROR = "Internal server error";
    public static final String VALIDATION_FAILED = "Validation failed";
    public static final String RESOURCE_NOT_FOUND = "Resource not found";
    public static final String OPERATION_FAILED = "Operation failed";
}

