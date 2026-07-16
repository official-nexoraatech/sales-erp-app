export const PERMISSIONS = {
  // ── Organization ─────────────────────────────────────────────────────────
  // PG-014: ORGANIZATION_UPDATE/ORGANIZATION_SETTINGS_VIEW/ORGANIZATION_SETTINGS_UPDATE
  // retired — duplicates of ORGANIZATION_VIEW/ORG_SETTINGS_EDIT that were never actually
  // checked anywhere; those two are the real, enforced constants for this resource.
  ORGANIZATION_VIEW: 'ORGANIZATION_VIEW',

  // ── Branch ───────────────────────────────────────────────────────────────
  // PG-014: BRANCH_CREATE/BRANCH_UPDATE/BRANCH_DELETE/BRANCH_ASSIGN_USER retired — no
  // route ever checked them; real enforcement is the single coarse BRANCH_MANAGE below.
  BRANCH_VIEW: 'BRANCH_VIEW',
  // ES-31: record-level branch scoping bypass — sees all branches' data in the tenant
  // instead of only the branches assigned to the user. Not about managing branch master
  // records (that's BRANCH_MANAGE) — this is the transactional-data-visibility dimension.
  BRANCH_SCOPE_BYPASS: 'BRANCH_SCOPE_BYPASS',

  // ── Warehouse ─────────────────────────────────────────────────────────────
  WAREHOUSE_VIEW: 'WAREHOUSE_VIEW',
  WAREHOUSE_CREATE: 'WAREHOUSE_CREATE',
  WAREHOUSE_UPDATE: 'WAREHOUSE_UPDATE',
  WAREHOUSE_DELETE: 'WAREHOUSE_DELETE',

  // ── Users ─────────────────────────────────────────────────────────────────
  USER_VIEW: 'USER_VIEW',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  // PG-014: USER_RESET_PASSWORD/USER_ACTIVATE/USER_DEACTIVATE retired — no route ever
  // checked them; real enforcement is the single coarse USER_MANAGE below.

  // ── Roles ─────────────────────────────────────────────────────────────────
  ROLE_VIEW: 'ROLE_VIEW',
  ROLE_CREATE: 'ROLE_CREATE',
  ROLE_UPDATE: 'ROLE_UPDATE',
  ROLE_DELETE: 'ROLE_DELETE',
  ROLE_ASSIGN_PERMISSION: 'ROLE_ASSIGN_PERMISSION',
  ROLE_ASSIGN_USER: 'ROLE_ASSIGN_USER',

  // ── Customers ─────────────────────────────────────────────────────────────
  CUSTOMER_VIEW: 'CUSTOMER_VIEW',
  CUSTOMER_CREATE: 'CUSTOMER_CREATE',
  CUSTOMER_UPDATE: 'CUSTOMER_UPDATE',
  CUSTOMER_DELETE: 'CUSTOMER_DELETE',
  CUSTOMER_CREDIT_LIMIT_VIEW: 'CUSTOMER_CREDIT_LIMIT_VIEW',
  CUSTOMER_CREDIT_LIMIT_UPDATE: 'CUSTOMER_CREDIT_LIMIT_UPDATE',
  CUSTOMER_STATEMENT_VIEW: 'CUSTOMER_STATEMENT_VIEW',
  CUSTOMER_BLOCK: 'CUSTOMER_BLOCK',
  CUSTOMER_MERGE: 'CUSTOMER_MERGE',
  CUSTOMER_IMPORT: 'CUSTOMER_IMPORT',
  CUSTOMER_EXPORT: 'CUSTOMER_EXPORT',

  // ── Suppliers ─────────────────────────────────────────────────────────────
  SUPPLIER_VIEW: 'SUPPLIER_VIEW',
  SUPPLIER_CREATE: 'SUPPLIER_CREATE',
  SUPPLIER_UPDATE: 'SUPPLIER_UPDATE',
  SUPPLIER_DELETE: 'SUPPLIER_DELETE',
  SUPPLIER_STATEMENT_VIEW: 'SUPPLIER_STATEMENT_VIEW',
  SUPPLIER_IMPORT: 'SUPPLIER_IMPORT',
  SUPPLIER_EXPORT: 'SUPPLIER_EXPORT',

  // ── Items / Products ──────────────────────────────────────────────────────
  ITEM_VIEW: 'ITEM_VIEW',
  ITEM_CREATE: 'ITEM_CREATE',
  ITEM_UPDATE: 'ITEM_UPDATE',
  ITEM_DELETE: 'ITEM_DELETE',
  ITEM_PRICE_UPDATE: 'ITEM_PRICE_UPDATE',
  ITEM_IMPORT: 'ITEM_IMPORT',
  ITEM_EXPORT: 'ITEM_EXPORT',
  ITEM_BARCODE_PRINT: 'ITEM_BARCODE_PRINT',

  // ── Categories / Brands / Units ──────────────────────────────────────────
  CATEGORY_VIEW: 'CATEGORY_VIEW',
  CATEGORY_CREATE: 'CATEGORY_CREATE',
  CATEGORY_UPDATE: 'CATEGORY_UPDATE',
  CATEGORY_DELETE: 'CATEGORY_DELETE',
  BRAND_VIEW: 'BRAND_VIEW',
  BRAND_CREATE: 'BRAND_CREATE',
  BRAND_UPDATE: 'BRAND_UPDATE',
  UNIT_VIEW: 'UNIT_VIEW',
  UNIT_CREATE: 'UNIT_CREATE',
  UNIT_UPDATE: 'UNIT_UPDATE',

  // ── Invoices (Sales) ──────────────────────────────────────────────────────
  INVOICE_VIEW: 'INVOICE_VIEW',
  INVOICE_CREATE: 'INVOICE_CREATE',
  INVOICE_UPDATE: 'INVOICE_UPDATE',
  INVOICE_CANCEL: 'INVOICE_CANCEL',
  INVOICE_APPROVE: 'INVOICE_APPROVE',
  INVOICE_PRINT: 'INVOICE_PRINT',
  INVOICE_EMAIL: 'INVOICE_EMAIL',
  INVOICE_EXPORT: 'INVOICE_EXPORT',
  INVOICE_DELETE_DRAFT: 'INVOICE_DELETE_DRAFT',

  // ── Quotations ────────────────────────────────────────────────────────────
  QUOTATION_VIEW: 'QUOTATION_VIEW',
  QUOTATION_CREATE: 'QUOTATION_CREATE',
  QUOTATION_UPDATE: 'QUOTATION_UPDATE',
  QUOTATION_CANCEL: 'QUOTATION_CANCEL',
  QUOTATION_CONVERT: 'QUOTATION_CONVERT',
  QUOTATION_PRINT: 'QUOTATION_PRINT',

  // ── Payments In (Customer Receipts) ──────────────────────────────────────
  PAYMENT_IN_VIEW: 'PAYMENT_IN_VIEW',
  PAYMENT_IN_CREATE: 'PAYMENT_IN_CREATE',
  PAYMENT_IN_CANCEL: 'PAYMENT_IN_CANCEL',
  PAYMENT_IN_PRINT: 'PAYMENT_IN_PRINT',

  // ── Sale Returns ──────────────────────────────────────────────────────────
  SALE_RETURN_VIEW: 'SALE_RETURN_VIEW',
  SALE_RETURN_CREATE: 'SALE_RETURN_CREATE',
  SALE_RETURN_APPROVE: 'SALE_RETURN_APPROVE',
  SALE_RETURN_CANCEL: 'SALE_RETURN_CANCEL',

  // ── Credit Notes ──────────────────────────────────────────────────────────
  CREDIT_NOTE_VIEW: 'CREDIT_NOTE_VIEW',
  CREDIT_NOTE_CREATE: 'CREDIT_NOTE_CREATE',
  CREDIT_NOTE_CANCEL: 'CREDIT_NOTE_CANCEL',
  CREDIT_NOTE_ADJUST: 'CREDIT_NOTE_ADJUST',

  // ── POS ───────────────────────────────────────────────────────────────────
  POS_ACCESS: 'POS_ACCESS',
  POS_OPEN_SHIFT: 'POS_OPEN_SHIFT',
  POS_CLOSE_SHIFT: 'POS_CLOSE_SHIFT',
  POS_APPLY_DISCOUNT: 'POS_APPLY_DISCOUNT',
  POS_VOID_BILL: 'POS_VOID_BILL',
  POS_CASH_DRAWER: 'POS_CASH_DRAWER',

  // ── Purchase Orders ───────────────────────────────────────────────────────
  PO_VIEW: 'PO_VIEW',
  PO_CREATE: 'PO_CREATE',
  PO_UPDATE: 'PO_UPDATE',
  PO_APPROVE: 'PO_APPROVE',
  PO_AMEND: 'PO_AMEND',
  PO_CANCEL: 'PO_CANCEL',
  PO_PRINT: 'PO_PRINT',
  PO_EMAIL: 'PO_EMAIL',

  // ── GRN (Goods Receipt Note) ──────────────────────────────────────────────
  GRN_VIEW: 'GRN_VIEW',
  GRN_CREATE: 'GRN_CREATE',
  GRN_UPDATE: 'GRN_UPDATE',
  GRN_APPROVE: 'GRN_APPROVE',
  GRN_CANCEL: 'GRN_CANCEL',

  // ── Purchase Returns ──────────────────────────────────────────────────────
  PURCHASE_RETURN_VIEW: 'PURCHASE_RETURN_VIEW',
  PURCHASE_RETURN_CREATE: 'PURCHASE_RETURN_CREATE',
  PURCHASE_RETURN_APPROVE: 'PURCHASE_RETURN_APPROVE',

  // ── Payments Out (Supplier Payments) ─────────────────────────────────────
  PAYMENT_OUT_VIEW: 'PAYMENT_OUT_VIEW',
  PAYMENT_OUT_CREATE: 'PAYMENT_OUT_CREATE',
  PAYMENT_OUT_CANCEL: 'PAYMENT_OUT_CANCEL',
  PAYMENT_OUT_APPROVE: 'PAYMENT_OUT_APPROVE',

  // ── Expenses ──────────────────────────────────────────────────────────────
  EXPENSE_VIEW: 'EXPENSE_VIEW',
  EXPENSE_CREATE: 'EXPENSE_CREATE',
  EXPENSE_APPROVE: 'EXPENSE_APPROVE',
  EXPENSE_CANCEL: 'EXPENSE_CANCEL',

  // ── Accounting ────────────────────────────────────────────────────────────
  ACCOUNT_VIEW: 'ACCOUNT_VIEW',
  ACCOUNT_CREATE: 'ACCOUNT_CREATE',
  ACCOUNT_UPDATE: 'ACCOUNT_UPDATE',
  VOUCHER_CREATE: 'VOUCHER_CREATE',
  VOUCHER_VIEW: 'VOUCHER_VIEW',
  VOUCHER_CANCEL: 'VOUCHER_CANCEL',
  JOURNAL_VIEW: 'JOURNAL_VIEW',
  JOURNAL_CREATE: 'JOURNAL_CREATE',
  LEDGER_VIEW: 'LEDGER_VIEW',
  LEDGER_EXPORT: 'LEDGER_EXPORT',
  BALANCE_SHEET_VIEW: 'BALANCE_SHEET_VIEW',
  PROFIT_LOSS_VIEW: 'PROFIT_LOSS_VIEW',
  TRIAL_BALANCE_VIEW: 'TRIAL_BALANCE_VIEW',
  BANK_RECONCILIATION_VIEW: 'BANK_RECONCILIATION_VIEW',
  BANK_RECONCILIATION_DO: 'BANK_RECONCILIATION_DO',
  FINANCIAL_YEAR_VIEW: 'FINANCIAL_YEAR_VIEW',
  FINANCIAL_YEAR_CLOSE: 'FINANCIAL_YEAR_CLOSE',
  FINANCIAL_YEAR_OPEN: 'FINANCIAL_YEAR_OPEN',
  COST_CENTER_VIEW: 'COST_CENTER_VIEW',
  COST_CENTER_MANAGE: 'COST_CENTER_MANAGE',

  // ── GST ───────────────────────────────────────────────────────────────────
  GST_VIEW: 'GST_VIEW',
  GST_FILE: 'GST_FILE',
  GST_RECONCILE: 'GST_RECONCILE',
  EINVOICE_GENERATE: 'EINVOICE_GENERATE',
  EINVOICE_CANCEL: 'EINVOICE_CANCEL',
  EWAY_BILL_GENERATE: 'EWAY_BILL_GENERATE',
  EWAY_BILL_CANCEL: 'EWAY_BILL_CANCEL',
  GSTR1_VIEW: 'GSTR1_VIEW',
  GSTR1_FILE: 'GSTR1_FILE',
  GSTR3B_VIEW: 'GSTR3B_VIEW',
  GSTR3B_FILE: 'GSTR3B_FILE',
  GSTR9_VIEW: 'GSTR9_VIEW',
  GSTR9_FILE: 'GSTR9_FILE',
  GSTR2A_RECONCILE: 'GSTR2A_RECONCILE',

  // ── Inventory / Stock ─────────────────────────────────────────────────────
  STOCK_VIEW: 'STOCK_VIEW',
  STOCK_ADJUST: 'STOCK_ADJUST',
  STOCK_ADJUST_APPROVE: 'STOCK_ADJUST_APPROVE',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
  STOCK_TRANSFER_APPROVE: 'STOCK_TRANSFER_APPROVE',
  STOCK_PHYSICAL_VERIFY: 'STOCK_PHYSICAL_VERIFY',
  STOCK_RESERVE: 'STOCK_RESERVE',
  STOCK_REPORT_VIEW: 'STOCK_REPORT_VIEW',
  FABRIC_ROLL_VIEW: 'FABRIC_ROLL_VIEW',
  FABRIC_ROLL_CREATE: 'FABRIC_ROLL_CREATE',

  // ── HR ────────────────────────────────────────────────────────────────────
  HR_MANAGE: 'HR_MANAGE',
  VIEW_SALARY_DETAILS: 'VIEW_SALARY_DETAILS',
  EMPLOYEE_VIEW: 'EMPLOYEE_VIEW',
  EMPLOYEE_CREATE: 'EMPLOYEE_CREATE',
  EMPLOYEE_UPDATE: 'EMPLOYEE_UPDATE',
  EMPLOYEE_DELETE: 'EMPLOYEE_DELETE',
  EMPLOYEE_IMPORT: 'EMPLOYEE_IMPORT',
  ATTENDANCE_VIEW: 'ATTENDANCE_VIEW',
  ATTENDANCE_MARK: 'ATTENDANCE_MARK',
  ATTENDANCE_CORRECT: 'ATTENDANCE_CORRECT',
  ATTENDANCE_REPORT: 'ATTENDANCE_REPORT',
  LEAVE_VIEW: 'LEAVE_VIEW',
  LEAVE_APPLY: 'LEAVE_APPLY',
  LEAVE_APPROVE: 'LEAVE_APPROVE',
  LEAVE_REJECT: 'LEAVE_REJECT',
  PAYROLL_VIEW: 'PAYROLL_VIEW',
  PAYROLL_PROCESS: 'PAYROLL_PROCESS',
  PAYROLL_APPROVE: 'PAYROLL_APPROVE',
  SALARY_VIEW: 'SALARY_VIEW',
  SALARY_SLIP_PRINT: 'SALARY_SLIP_PRINT',
  HR_STATUTORY: 'HR_STATUTORY',
  EMPLOYEE_LOAN_MANAGE: 'EMPLOYEE_LOAN_MANAGE',
  ALTERATION_VIEW: 'ALTERATION_VIEW',
  ALTERATION_CREATE: 'ALTERATION_CREATE',
  ALTERATION_UPDATE: 'ALTERATION_UPDATE',

  // ── CRM ───────────────────────────────────────────────────────────────────
  CRM_VIEW: 'CRM_VIEW',
  CRM_CAMPAIGN_CREATE: 'CRM_CAMPAIGN_CREATE',
  CRM_CAMPAIGN_SEND: 'CRM_CAMPAIGN_SEND',
  // CP-7 (Campaign Management Platform initiative): distinct from CRM_CAMPAIGN_SEND — approving
  // a PENDING_APPROVAL campaign is a separate action from sending an already-approved one.
  // Backfilled for existing tenants' OWNER/ADMIN/SUPER_ADMIN roles in
  // packages/db-client/migrations/0057_cp7_campaign_approve_permission_backfill.sql (role-defaults
  // .ts's wildcard only covers NEW tenants provisioned after this constant was added — see the
  // repo's documented dead-permission-constant pattern before assuming this alone is enough).
  CRM_CAMPAIGN_APPROVE: 'CRM_CAMPAIGN_APPROVE',
  // CP-7: gates campaign-level analytics (stats/recipients breakdown) separately from basic
  // CRM_VIEW, so a tenant can grant campaign visibility without exposing delivery/engagement
  // numbers. Backfilled alongside CRM_AUTOMATION_MANAGE in
  // packages/db-client/migrations/0058_cp7_campaign_analytics_automation_permission_backfill.sql.
  CRM_CAMPAIGN_ANALYTICS_VIEW: 'CRM_CAMPAIGN_ANALYTICS_VIEW',
  // CP-7: gates creating/editing automation rules (previously reused CRM_CAMPAIGN_CREATE) — a
  // tenant may want a different set of people managing always-on trigger rules than authoring
  // one-off campaigns. Backfilled in migration 0058 above.
  CRM_AUTOMATION_MANAGE: 'CRM_AUTOMATION_MANAGE',
  // CP-8: manage per-tenant/per-channel sender identity (tenant_sender_identity). Backfilled
  // for existing tenants in
  // packages/db-client/migrations/0060_cp8_sender_identity_webhook_permission_backfill.sql.
  CRM_SENDER_IDENTITY_MANAGE: 'CRM_SENDER_IDENTITY_MANAGE',
  // Manage outbound webhook subscriptions for third-party tools. Originally CRM-scoped
  // (CRM_WEBHOOK_MANAGE, CP-8) — renamed when the underlying feature was generalized beyond
  // campaign events to any business event (invoice/payment/etc). Existing grants renamed in
  // packages/db-client/migrations/0063_webhook_generalization.sql.
  INTEGRATION_WEBHOOK_MANAGE: 'INTEGRATION_WEBHOOK_MANAGE',
  CRM_LOYALTY_VIEW: 'CRM_LOYALTY_VIEW',
  CRM_LOYALTY_ADJUST: 'CRM_LOYALTY_ADJUST',
  CRM_INTERACTION_VIEW: 'CRM_INTERACTION_VIEW',
  CRM_INTERACTION_CREATE: 'CRM_INTERACTION_CREATE',
  CRM_SEGMENT_VIEW: 'CRM_SEGMENT_VIEW',
  CRM_SEGMENT_CREATE: 'CRM_SEGMENT_CREATE',
  CRM_SEASON_VIEW: 'CRM_SEASON_VIEW',
  CRM_SEASON_MANAGE: 'CRM_SEASON_MANAGE',

  // ── Reports ───────────────────────────────────────────────────────────────
  REPORT_VIEW: 'REPORT_VIEW',
  REPORT_EXPORT: 'REPORT_EXPORT',
  REPORT_SCHEDULE: 'REPORT_SCHEDULE',
  REPORT_SHARE: 'REPORT_SHARE',

  // ── Dashboard ─────────────────────────────────────────────────────────────
  DASHBOARD_VIEW: 'DASHBOARD_VIEW',

  // ── Approvals / Workflows ────────────────────────────────────────────────
  // PG-014: APPROVAL_VIEW/APPROVAL_APPROVE/APPROVAL_REJECT/WORKFLOW_CONFIG retired.
  // Approvals are intentionally scoped by `approverId = caller` in tenant-service's
  // approval.routes.ts, not by a permission grant — an approver only ever sees and can
  // act on their own pending items, which can't be misconfigured by role setup the way a
  // permission-gated model could. This is the permanent design, not a gap. WORKFLOW_CONFIG
  // had zero implementation surface (no route manages workflow definitions today).

  // ── Notifications ─────────────────────────────────────────────────────────
  NOTIFICATION_VIEW: 'NOTIFICATION_VIEW',
  NOTIFICATION_SEND: 'NOTIFICATION_SEND',
  NOTIFICATION_CONFIG: 'NOTIFICATION_CONFIG',

  // ── Scheduler / Jobs ──────────────────────────────────────────────────────
  JOB_VIEW: 'JOB_VIEW',
  JOB_TRIGGER: 'JOB_TRIGGER',
  JOB_PAUSE: 'JOB_PAUSE',
  JOB_CONFIG: 'JOB_CONFIG',

  // ── Import / Export ───────────────────────────────────────────────────────
  IMPORT_VIEW: 'IMPORT_VIEW',
  IMPORT_EXECUTE: 'IMPORT_EXECUTE',
  IMPORT_ROLLBACK: 'IMPORT_ROLLBACK',
  EXPORT_VIEW: 'EXPORT_VIEW',
  EXPORT_GENERATE: 'EXPORT_GENERATE',

  // ── Search ────────────────────────────────────────────────────────────────
  SEARCH_GLOBAL: 'SEARCH_GLOBAL',
  SEARCH_REINDEX: 'SEARCH_REINDEX',

  // ── Business Rules ────────────────────────────────────────────────────────
  RULE_VIEW: 'RULE_VIEW',
  RULE_CREATE: 'RULE_CREATE',
  RULE_UPDATE: 'RULE_UPDATE',
  RULE_DELETE: 'RULE_DELETE',
  RULE_SIMULATE: 'RULE_SIMULATE',

  // ── Price Lists ───────────────────────────────────────────────────────────
  PRICE_LIST_VIEW: 'PRICE_LIST_VIEW',
  PRICE_LIST_CREATE: 'PRICE_LIST_CREATE',
  PRICE_LIST_UPDATE: 'PRICE_LIST_UPDATE',
  PRICE_LIST_DELETE: 'PRICE_LIST_DELETE',

  // ── Overrides ─────────────────────────────────────────────────────────────
  CREDIT_LIMIT_OVERRIDE: 'CREDIT_LIMIT_OVERRIDE', // POST /invoices (when overrideCreditLimit=true)
  DISCOUNT_OVERRIDE: 'DISCOUNT_OVERRIDE',
  PRICE_OVERRIDE: 'PRICE_OVERRIDE',
  PRICE_FLOOR_OVERRIDE: 'PRICE_FLOOR_OVERRIDE', // POST /invoices (when overridePriceFloor=true)
  CANCEL_POSTED_JOURNAL: 'CANCEL_POSTED_JOURNAL', // POST /journals/:id/reverse
  EXPORT_CUSTOMER_DATA: 'EXPORT_CUSTOMER_DATA', // GET /customers/export
  VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG', // GET /admin/audit-logs (not yet implemented — ES-20)
  IMPERSONATE_USER: 'IMPERSONATE_USER', // POST /admin/impersonate (auth-service)

  // ── Config / Audit ────────────────────────────────────────────────────────
  // PG-014: generic CONFIG_VIEW/CONFIG_UPDATE retired — no route ever checked them;
  // superseded by the specific config surfaces below (NUMBER_SERIES_CONFIG, FEATURE_FLAG_*).
  NUMBER_SERIES_CONFIG: 'NUMBER_SERIES_CONFIG',
  FEATURE_FLAG_VIEW: 'FEATURE_FLAG_VIEW',
  FEATURE_FLAG_UPDATE: 'FEATURE_FLAG_UPDATE',
  AUDIT_LOG_VIEW: 'AUDIT_LOG_VIEW',
  // PG-020: single coarse permission covering view/create/update/delete of the tenant's
  // SSO config — an admin-only config surface, not high-volume transactional data, so it
  // follows the BRANCH_MANAGE/USER_MANAGE/WAREHOUSE_MANAGE precedent rather than splitting
  // into four CRUD constants.
  SSO_CONFIG_MANAGE: 'SSO_CONFIG_MANAGE',

  // ── Phase 2 additions (FA.2) ──────────────────────────────────────────────
  WAREHOUSE_MANAGE: 'WAREHOUSE_MANAGE',
  CUSTOMER_EDIT: 'CUSTOMER_EDIT',
  ITEM_EDIT: 'ITEM_EDIT',
  SUPPLIER_EDIT: 'SUPPLIER_EDIT',
  SUPPLIER_BANK_VIEW: 'SUPPLIER_BANK_VIEW',
  OPENING_BALANCE_LOCK: 'OPENING_BALANCE_LOCK',
  ORG_SETTINGS_EDIT: 'ORG_SETTINGS_EDIT',
  BRANCH_MANAGE: 'BRANCH_MANAGE',
  GST_COMPUTE: 'GST_COMPUTE',
  USER_MANAGE: 'USER_MANAGE',

  // ── Phase 4 additions ─────────────────────────────────────────────────────
  PAYMENT_VIEW: 'PAYMENT_VIEW',
  PAYMENT_CREATE: 'PAYMENT_CREATE',
  POS_MANAGE: 'POS_MANAGE',

  // ── Phase 3 additions ─────────────────────────────────────────────────────
  STOCK_TRANSFER_VIEW: 'STOCK_TRANSFER_VIEW',
  STOCK_TRANSFER_MANAGE: 'STOCK_TRANSFER_MANAGE',
  STOCK_ADJUSTMENT_VIEW: 'STOCK_ADJUSTMENT_VIEW',
  STOCK_ADJUSTMENT_MANAGE: 'STOCK_ADJUSTMENT_MANAGE',
  PHYSICAL_VERIFICATION_VIEW: 'PHYSICAL_VERIFICATION_VIEW',
  PHYSICAL_VERIFICATION_MANAGE: 'PHYSICAL_VERIFICATION_MANAGE',
  FABRIC_ROLL_MANAGE: 'FABRIC_ROLL_MANAGE',

  // ── Phase 10 — Production / Job Work / Barcodes / Consignment ────────────
  JOB_WORK_VIEW: 'JOB_WORK_VIEW',
  JOB_WORK_CREATE: 'JOB_WORK_CREATE',
  JOB_WORK_UPDATE: 'JOB_WORK_UPDATE',
  JOB_WORK_ISSUE_MATERIALS: 'JOB_WORK_ISSUE_MATERIALS',
  JOB_WORK_QUALITY_CHECK: 'JOB_WORK_QUALITY_CHECK',
  JOB_WORK_COMPLETE: 'JOB_WORK_COMPLETE',
  JOB_WORK_CANCEL: 'JOB_WORK_CANCEL',
  BARCODE_VIEW: 'BARCODE_VIEW',
  BARCODE_GENERATE: 'BARCODE_GENERATE',
  BARCODE_PRINT: 'BARCODE_PRINT',
  CONSIGNMENT_VIEW: 'CONSIGNMENT_VIEW',
  CONSIGNMENT_RECEIVE: 'CONSIGNMENT_RECEIVE',
  CONSIGNMENT_SETTLE: 'CONSIGNMENT_SETTLE',
  CONSIGNMENT_RETURN: 'CONSIGNMENT_RETURN',
  REORDER_VIEW: 'REORDER_VIEW',
  REORDER_CREATE_PO: 'REORDER_CREATE_PO',

  // ── Phase 6 additions (Accounting Domain) ────────────────────────────────
  CASH_FLOW_VIEW: 'CASH_FLOW_VIEW',
  FIXED_ASSET_VIEW: 'FIXED_ASSET_VIEW',
  FIXED_ASSET_CREATE: 'FIXED_ASSET_CREATE',
  FIXED_ASSET_UPDATE: 'FIXED_ASSET_UPDATE',
  FIXED_ASSET_DISPOSE: 'FIXED_ASSET_DISPOSE',
  TDS_VIEW: 'TDS_VIEW',
  TDS_MANAGE: 'TDS_MANAGE',
  POSTING_MATRIX_VIEW: 'POSTING_MATRIX_VIEW',
  POSTING_MATRIX_UPDATE: 'POSTING_MATRIX_UPDATE',

  // ── Phase 12 — Distributed Systems Admin ─────────────────────────────────
  EVENT_STORE_VIEW: 'EVENT_STORE_VIEW',
  DLQ_VIEW: 'DLQ_VIEW',
  DLQ_MANAGE: 'DLQ_MANAGE',
  SAGA_VIEW: 'SAGA_VIEW',
  SAGA_MANAGE: 'SAGA_MANAGE',
  SCHEMA_REGISTRY_VIEW: 'SCHEMA_REGISTRY_VIEW',
  SCHEMA_REGISTRY_MANAGE: 'SCHEMA_REGISTRY_MANAGE',
  PROJECTION_VIEW: 'PROJECTION_VIEW',
  PROJECTION_MANAGE: 'PROJECTION_MANAGE',
  PERFORMANCE_VIEW: 'PERFORMANCE_VIEW',

  // ── Platform-level permissions — cross-tenant, not scoped to request.auth.tenantId. ──
  // Only assignable to a platform-operator role, never a tenant's own Owner/Admin role.
  PLATFORM_TENANT_MANAGE: 'PLATFORM_TENANT_MANAGE',
  // Manage the public marketing site's FAQ content (faq_items — global, not tenant-scoped).
  // Platform-operator only, like PLATFORM_TENANT_MANAGE, since this is platform content.
  PLATFORM_CONTENT_MANAGE: 'PLATFORM_CONTENT_MANAGE',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
