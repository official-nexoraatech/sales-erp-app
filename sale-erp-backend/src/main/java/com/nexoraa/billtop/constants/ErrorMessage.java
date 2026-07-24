package com.nexoraa.billtop.constants;

/**
 * Error message constants for API error responses.
 */
public class ErrorMessage {

    private ErrorMessage() {
    }

    // Authentication Errors
    public static final String INVALID_CREDENTIALS = "Username password not correct";
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
    public static final String ORGANIZATION_NOT_SUBSCRIBED = "You are not subscribed user please contact to application owner";

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
    public static final String BRAND_NOT_FOUND_FOR_CATEGORY = "No brands found for this category";
    public static final String BRAND_ALREADY_EXISTS = "Brand already exists";

    // Unit Errors
    public static final String UNIT_NOT_FOUND = "Unit not found";
    public static final String UNIT_ALREADY_EXISTS = "Unit already exists";

    // Warehouse Errors
    public static final String WAREHOUSE_NOT_FOUND = "Warehouse not found";
    public static final String WAREHOUSE_ALREADY_EXISTS = "Warehouse already exists";

    // Branch Errors
    public static final String BRANCH_NOT_FOUND = "Branch not found";
    public static final String BRANCH_ALREADY_EXISTS = "Branch already exists";
    public static final String BRANCH_REQUIRED = "Branch is required";
    public static final String BRANCH_ACCESS_DENIED = "You do not have access to the selected branch";
    public static final String BRANCH_NOT_IN_ORGANIZATION = "Branch does not belong to your organization";

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
    public static final String PAYMENT_METHOD_ALREADY_EXISTS = "Payment method already exists";
    public static final String INSUFFICIENT_STOCK = "Insufficient stock";
    public static final String INVALID_EXPIRY_DATE = "Expiry date must be after manufacturing date";

    // Purchase/Sales Errors
    public static final String EXPENSE_NOT_FOUND = "Expense not found";
    public static final String EXPENSE_CATEGORY_NOT_FOUND = "Expense category not found";
    public static final String EXPENSE_CATEGORY_ALREADY_EXISTS = "Expense category already exists";
    public static final String EXPENSE_SUB_CATEGORY_NOT_FOUND = "Expense sub category not found";
    public static final String EXPENSE_SUB_CATEGORY_ALREADY_EXISTS = "Expense sub category already exists";
    public static final String PURCHASE_NOT_FOUND = "Purchase not found";
    public static final String PURCHASE_RETURN_NOT_FOUND = "Purchase return not found";
    public static final String SALE_NOT_FOUND = "Sales invoice not found";
    public static final String SALES_RETURN_NOT_FOUND = "Sales return not found";
    public static final String PURCHASE_ALREADY_CANCELLED = "Purchase is already cancelled";
    public static final String SALE_ALREADY_CANCELLED = "Sales invoice is already cancelled";
    public static final String SALE_HAS_PAYMENTS = "Cannot delete a sale that has payments applied to it";
    public static final String PURCHASE_HAS_PAYMENTS = "Cannot delete a purchase that has payments applied to it";
    public static final String PAYMENT_NOT_FOUND = "Payment not found";

    // Payment Note Errors
    public static final String PAYMENT_NOTE_NOT_FOUND = "Payment note not found";
    public static final String INVALID_PAYMENT_NOTE_STATUS = "Invalid payment note status";

    // Role Errors
    public static final String ROLE_NOT_FOUND = "Role not found";
    public static final String ROLE_ALREADY_EXISTS = "Role already exists";
    public static final String ADMIN_ROLE_PROTECTED = "The Admin role cannot be deleted";

    // User Errors
    public static final String ADMIN_USER_PROTECTED = "Admin users can only be managed by a Super Admin";

    // Permission Errors
    public static final String PERMISSION_NOT_FOUND = "Permission not found";
    public static final String PERMISSION_ALREADY_EXISTS = "Permission already exists";

    // SMS Errors
    public static final String SMS_TEMPLATE_NOT_FOUND = "SMS template not found";
    public static final String SMS_TEMPLATE_ALREADY_EXISTS = "SMS template already exists";
    public static final String INVALID_MOBILE_NUMBERS = "One or more mobile numbers are invalid";
    public static final String SMS_SEND_FAILED = "SMS send failed";

    // WhatsApp Errors
    public static final String INVALID_WHATSAPP_NUMBERS = "One or more WhatsApp numbers are invalid";
    public static final String WHATSAPP_SEND_FAILED = "WhatsApp message send failed";
    public static final String WHATSAPP_TEMPLATE_NOT_CONFIGURED = "WhatsApp invoice template is not configured";
    public static final String WHATSAPP_NUMBER_NOT_FOUND = "Customer does not have a WhatsApp or mobile number on file";

    // Email Errors
    public static final String EMAIL_TEMPLATE_NOT_FOUND = "Email template not found";
    public static final String EMAIL_TEMPLATE_ALREADY_EXISTS = "Email template already exists";
    public static final String INVALID_EMAIL_IDS = "One or more email IDs are invalid";
    public static final String EMAIL_SEND_FAILED = "Email send failed";

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
    public static final String DATA_INTEGRITY_VIOLATION = "Request could not be completed because it conflicts with existing data";
    public static final String DATABASE_ERROR = "A database error occurred while processing the request";
}

