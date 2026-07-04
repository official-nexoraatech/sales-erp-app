package com.nexoraa.billtop.constants;

/**
 * Validation message constants for validation errors.
 */
public class ValidationMessage {

    private ValidationMessage() {
    }

    // Username Validation
    public static final String USERNAME_REQUIRED = "Username is required";
    public static final String USERNAME_INVALID = "Username must be between 3 and 50 characters";

    // Email Validation
    public static final String EMAIL_REQUIRED = "Email is required";
    public static final String EMAIL_INVALID = "Email must be valid";
    public static final String EMAIL_EXISTS = "Email already exists";

    // Password Validation
    public static final String PASSWORD_REQUIRED = "Password is required";
    public static final String PASSWORD_INVALID = "Password must be at least 6 characters";

    // Name Validation
    public static final String FIRST_NAME_REQUIRED = "First name is required";
    public static final String FIRST_NAME_INVALID = "First name must be between 2 and 100 characters";
    public static final String LAST_NAME_REQUIRED = "Last name is required";
    public static final String LAST_NAME_INVALID = "Last name must be between 2 and 100 characters";

    // Mobile Validation
    public static final String MOBILE_REQUIRED = "Mobile number is required";
    public static final String MOBILE_INVALID = "Mobile number must be valid";

    // Contact Validation
    public static final String GST_NUMBER_INVALID = "GST number must be valid";
    public static final String PAN_NUMBER_INVALID = "PAN number must be valid";
    public static final String OPENING_BALANCE_TYPE_INVALID = "Opening balance type must be valid";

    // Address Validation
    public static final String ADDRESS_REQUIRED = "Address is required";
    public static final String ADDRESS_INVALID = "Address must be 500 characters or less";
    public static final String ADDRESS_LINE_REQUIRED = "Address line 1 is required";
    public static final String CITY_REQUIRED = "City is required";
    public static final String PINCODE_INVALID = "Pincode must be valid";

    // Item Validation
    public static final String ITEM_NAME_REQUIRED = "Item name is required";
    public static final String ITEM_NAME_INVALID = "Item name must be between 2 and 200 characters";
    public static final String ITEM_CODE_REQUIRED = "Item code is required";
    public static final String PRICE_INVALID = "Amount must be zero or greater";
    public static final String BATCH_NO_REQUIRED = "Batch number is required";
    public static final String MANUFACTURE_DATE_REQUIRED = "Manufacture date is required";
    public static final String EXPIRY_DATE_REQUIRED = "Expiry date is required";
    public static final String MRP_REQUIRED = "MRP is required";
    public static final String QUANTITY_INVALID = "Opening quantity must be greater than 0";

    // Master Data Validation
    public static final String NAME_REQUIRED = "Name is required";
    public static final String NAME_INVALID = "Name must be between 2 and 100 characters";
    public static final String DESCRIPTION_INVALID = "Description must be 500 characters or less";
    public static final String SHORT_NAME_REQUIRED = "Short name is required";
    public static final String SHORT_NAME_INVALID = "Short name must be 20 characters or less";
    public static final String WAREHOUSE_CODE_REQUIRED = "Warehouse code is required";
    public static final String WAREHOUSE_CODE_INVALID = "Warehouse code must be 50 characters or less";
    public static final String ITEMS_REQUIRED = "At least one item is required";
    public static final String DATE_REQUIRED = "Date is required";
    public static final String QUANTITY_REQUIRED = "Quantity is required";
    public static final String URL_INVALID = "URL must be 500 characters or less";
    public static final String CONTENT_REQUIRED = "Content is required";
    public static final String MESSAGE_REQUIRED = "Message is required";
    public static final String SUBJECT_REQUIRED = "Subject is required";
    public static final String SUBJECT_INVALID = "Subject must be 200 characters or less";
    public static final String MOBILE_NUMBERS_REQUIRED = "At least one mobile number is required";

    // Role Validation
    public static final String ROLE_NAME_REQUIRED = "Role name is required";
    public static final String ROLE_NAME_INVALID = "Role name must be between 2 and 100 characters";
    public static final String ORGANIZATION_ID_REQUIRED = "Organization ID is required";

    // Permission Validation
    public static final String PERMISSION_NAME_REQUIRED = "Permission name is required";
    public static final String PERMISSION_GROUP_REQUIRED = "Permission group is required";

    // General Validation
    public static final String ID_REQUIRED = "ID is required";
    public static final String ID_INVALID = "ID must be a valid number";
}

