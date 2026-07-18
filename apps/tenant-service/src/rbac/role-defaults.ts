import { PERMISSIONS, type Permission } from '@erp/types';

// PLATFORM_TENANT_MANAGE (list/provision/suspend/close ANY tenant) and PLATFORM_CONTENT_MANAGE
// (manage the public marketing site's global, non-tenant-scoped FAQ content) are both
// cross-tenant and reserved for the PLATFORM_OPERATOR role in the platform-operations tenant
// only — see migration 0020_es21_platform_operator.sql. Neither must ever be included in a
// tenant-scoped role's defaults, even ones that otherwise enumerate "every permission".
const PLATFORM_ONLY_PERMISSIONS: Permission[] = [
  PERMISSIONS.PLATFORM_TENANT_MANAGE,
  PERMISSIONS.PLATFORM_CONTENT_MANAGE,
];
const TENANT_SCOPED_PERMISSIONS = (Object.values(PERMISSIONS) as Permission[]).filter(
  (p) => !PLATFORM_ONLY_PERMISSIONS.includes(p)
);

// Default permission sets per system role.
// Every tenant gets these roles seeded at provisioning time.
export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  OWNER: TENANT_SCOPED_PERMISSIONS,

  ADMIN: TENANT_SCOPED_PERMISSIONS.filter(
    (p) =>
      !(
        [
          PERMISSIONS.FINANCIAL_YEAR_CLOSE,
          PERMISSIONS.PAYROLL_PROCESS,
          PERMISSIONS.IMPERSONATE_USER,
        ] as Permission[]
      ).includes(p)
  ),

  SALES_MANAGER: [
    PERMISSIONS.INVOICE_VIEW,
    PERMISSIONS.INVOICE_CREATE,
    PERMISSIONS.INVOICE_UPDATE,
    PERMISSIONS.INVOICE_CANCEL,
    PERMISSIONS.INVOICE_APPROVE,
    PERMISSIONS.QUOTATION_VIEW,
    PERMISSIONS.QUOTATION_CREATE,
    PERMISSIONS.QUOTATION_UPDATE,
    PERMISSIONS.QUOTATION_CANCEL,
    PERMISSIONS.QUOTATION_CONVERT,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.SALE_RETURN_VIEW,
    PERMISSIONS.SALE_RETURN_CREATE,
    PERMISSIONS.SALE_RETURN_APPROVE,
    PERMISSIONS.CREDIT_NOTE_VIEW,
    PERMISSIONS.CREDIT_NOTE_CREATE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.CUSTOMER_EDIT,
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    // Security audit: REPORT_EXPORT never actually gated anything — the real bulk-export
    // feature (scheduler-service's POST /exports/generate, GET /exports/:jobId/download|status)
    // checks EXPORT_GENERATE/EXPORT_VIEW instead, which this role never held. Same
    // role-defaults.ts-omission pattern as migration 0066 (INVENTORY_MANAGER/WAREHOUSE_MANAGE) —
    // added here plus a backfill migration for existing tenants.
    PERMISSIONS.EXPORT_GENERATE,
    PERMISSIONS.EXPORT_VIEW,
    PERMISSIONS.DISCOUNT_OVERRIDE,
    PERMISSIONS.PRICE_OVERRIDE,
    PERMISSIONS.CREDIT_LIMIT_OVERRIDE,
    PERMISSIONS.PRICE_FLOOR_OVERRIDE,
    PERMISSIONS.CUSTOMER_CREDIT_LIMIT_UPDATE,
    PERMISSIONS.EXPORT_CUSTOMER_DATA,
    // Security audit: scheduler-service's bulk CSV import (customers) checks these three
    // generic constants — none of the roles that actually own an importable entity type
    // held them, so bulk import was effectively OWNER/ADMIN-only despite each entity's
    // normal CRUD already being delegated.
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_EXECUTE,
    PERMISSIONS.IMPORT_ROLLBACK,
    PERMISSIONS.POS_MANAGE,
    // Security audit: the Customer Loyalty Report (ReportRegistry.ts) is gated on this
    // separate constant, not CUSTOMER_VIEW/POS_MANAGE — this role could run loyalty
    // operations but never see the report on them.
    PERMISSIONS.CRM_LOYALTY_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  CASHIER: [
    PERMISSIONS.INVOICE_VIEW,
    PERMISSIONS.INVOICE_CREATE,
    PERMISSIONS.QUOTATION_VIEW,
    PERMISSIONS.QUOTATION_CREATE,
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.PAYMENT_CREATE,
    PERMISSIONS.SALE_RETURN_VIEW,
    PERMISSIONS.SALE_RETURN_CREATE,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    // CASHIER gets basic till access + shift open/close, but deliberately NOT
    // POS_CASH_DRAWER (that's a supervisor-tier report — SALES_MANAGER/ADMIN/OWNER get
    // it via their broader POS_MANAGE grant, checked via requireAnyPermission alongside
    // these granular ones). See qa_pos_frontend_module_2026-07-13 for the retail-controls
    // gap this closes — every POS route used to accept POS_MANAGE only, so any cashier
    // who could use the till at all could also see the cash-drawer report.
    PERMISSIONS.POS_ACCESS,
    PERMISSIONS.POS_OPEN_SHIFT,
    PERMISSIONS.POS_CLOSE_SHIFT,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  PURCHASE_MANAGER: [
    PERMISSIONS.PO_VIEW,
    PERMISSIONS.PO_CREATE,
    PERMISSIONS.PO_UPDATE,
    PERMISSIONS.PO_APPROVE,
    PERMISSIONS.PO_AMEND,
    PERMISSIONS.PO_CANCEL,
    PERMISSIONS.GRN_VIEW,
    PERMISSIONS.GRN_CREATE,
    PERMISSIONS.GRN_UPDATE,
    PERMISSIONS.GRN_APPROVE,
    PERMISSIONS.PURCHASE_RETURN_VIEW,
    PERMISSIONS.PURCHASE_RETURN_CREATE,
    PERMISSIONS.PURCHASE_RETURN_APPROVE,
    PERMISSIONS.PAYMENT_OUT_VIEW,
    PERMISSIONS.PAYMENT_OUT_CREATE,
    PERMISSIONS.SUPPLIER_VIEW,
    PERMISSIONS.SUPPLIER_CREATE,
    PERMISSIONS.SUPPLIER_EDIT,
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    // See SALES_MANAGER's bulk-import comment above — same omission (this role owns
    // suppliers, one of the importable entity types).
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_EXECUTE,
    PERMISSIONS.IMPORT_ROLLBACK,
    // Security audit: same reorder-report omission as INVENTORY_MANAGER — this role owns
    // PO creation, so it gets REORDER_CREATE_PO too, not just the view.
    PERMISSIONS.REORDER_VIEW,
    PERMISSIONS.REORDER_CREATE_PO,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  ACCOUNTANT: [
    PERMISSIONS.ACCOUNT_VIEW,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.VOUCHER_CREATE,
    PERMISSIONS.JOURNAL_VIEW,
    PERMISSIONS.JOURNAL_CREATE,
    PERMISSIONS.LEDGER_VIEW,
    PERMISSIONS.COST_CENTER_VIEW,
    PERMISSIONS.INVOICE_VIEW,
    PERMISSIONS.PAYMENT_IN_VIEW,
    PERMISSIONS.PAYMENT_OUT_VIEW,
    // Security audit: report-service's Payment Collection Report checks the single,
    // broader PAYMENT_VIEW constant (not PAYMENT_IN_VIEW/PAYMENT_OUT_VIEW) — this role
    // could see payment records via the sales-service routes (which accept either) but
    // 403'd on the report specifically about them.
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.EXPENSE_VIEW,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.GST_VIEW,
    PERMISSIONS.GST_FILE,
    PERMISSIONS.GSTR9_VIEW,
    PERMISSIONS.GSTR9_FILE,
    // Security audit: GST_FILE only gates the generic compliance-calendar "mark as filed"
    // endpoint — the actual monthly/quarterly returns (gst-service's gstr1.routes.ts,
    // gstr3b.routes.ts) check GSTR1_*/GSTR3B_* instead, which this role never held despite
    // already holding the once-a-year GSTR9_* pair. Same role-defaults.ts-omission pattern
    // as the EXPORT_GENERATE/EXPORT_VIEW fix above.
    PERMISSIONS.GSTR1_VIEW,
    PERMISSIONS.GSTR1_FILE,
    PERMISSIONS.GSTR3B_VIEW,
    PERMISSIONS.GSTR3B_FILE,
    PERMISSIONS.EINVOICE_GENERATE,
    // Security audit: this role held EINVOICE_GENERATE but not EINVOICE_CANCEL (einvoice.routes.ts
    // checks them separately), and held GST_FILE/GSTR1_FILE/GSTR3B_FILE but not GSTR2A_RECONCILE
    // or GST_COMPUTE — same role-defaults.ts-omission pattern as the GSTR1/GSTR3B fix above.
    // GstConfigPage's "Compute" button and the whole GSTR-2A reconciliation page were
    // reachable/visible but 403'd or were unreachable respectively for this role.
    PERMISSIONS.EINVOICE_CANCEL,
    PERMISSIONS.GSTR2A_RECONCILE,
    PERMISSIONS.GST_COMPUTE,
    PERMISSIONS.EWAY_BILL_GENERATE,
    PERMISSIONS.FIXED_ASSET_VIEW,
    PERMISSIONS.FIXED_ASSET_CREATE,
    PERMISSIONS.FIXED_ASSET_UPDATE,
    PERMISSIONS.FIXED_ASSET_DISPOSE,
    // Same omission pattern — TDS module (accounting-service's tds.routes.ts) was
    // unreachable despite this role owning the rest of tax/compliance.
    PERMISSIONS.TDS_VIEW,
    PERMISSIONS.TDS_MANAGE,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.AUDIT_LOG_VIEW,
    // PG-015: read-only visibility into the distributed-systems admin consoles that
    // used to be gated on the broad AUDIT_LOG_VIEW catch-all — view only, no *_MANAGE,
    // so this role can't trigger DLQ replay/Saga compensate/schema changes/rebuilds.
    PERMISSIONS.DLQ_VIEW,
    PERMISSIONS.SAGA_VIEW,
    PERMISSIONS.SCHEMA_REGISTRY_VIEW,
    PERMISSIONS.PROJECTION_VIEW,
    PERMISSIONS.EVENT_STORE_VIEW,
    PERMISSIONS.PERFORMANCE_VIEW,
    // See SALES_MANAGER's EXPORT_GENERATE/EXPORT_VIEW comment above — same dead-constant
    // fix for REPORT_EXPORT (this role also holds LEDGER_EXPORT, equally dead).
    PERMISSIONS.EXPORT_GENERATE,
    PERMISSIONS.EXPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  INVENTORY_MANAGER: [
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.STOCK_TRANSFER,
    // Security audit: this role could create/approve adjustments, transfers, physical
    // verifications, and fabric-roll operations, but couldn't view the corresponding
    // report-service reports or find its own transactions in Global Search — those check
    // the granular *_VIEW constants below, which STOCK_ADJUST/STOCK_TRANSFER don't cover.
    PERMISSIONS.STOCK_ADJUSTMENT_VIEW,
    PERMISSIONS.STOCK_TRANSFER_VIEW,
    PERMISSIONS.PHYSICAL_VERIFICATION_VIEW,
    PERMISSIONS.FABRIC_ROLL_VIEW,
    // Reorder report + "create PO from reorder" (production-service's reorder.routes.ts)
    // were unreachable — view-only here since PO creation itself stays a PURCHASE_MANAGER
    // action (see PURCHASE_MANAGER below).
    PERMISSIONS.REORDER_VIEW,
    // See SALES_MANAGER's bulk-import comment above — same omission (this role owns
    // items, one of the importable entity types).
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_EXECUTE,
    PERMISSIONS.IMPORT_ROLLBACK,
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.ITEM_CREATE,
    PERMISSIONS.ITEM_EDIT,
    PERMISSIONS.CATEGORY_VIEW,
    PERMISSIONS.CATEGORY_CREATE,
    PERMISSIONS.CATEGORY_UPDATE,
    PERMISSIONS.CATEGORY_DELETE,
    PERMISSIONS.BRAND_VIEW,
    PERMISSIONS.BRAND_CREATE,
    PERMISSIONS.BRAND_UPDATE,
    PERMISSIONS.UNIT_VIEW,
    PERMISSIONS.UNIT_CREATE,
    PERMISSIONS.UNIT_UPDATE,
    PERMISSIONS.WAREHOUSE_VIEW,
    PERMISSIONS.WAREHOUSE_CREATE,
    PERMISSIONS.WAREHOUSE_UPDATE,
    PERMISSIONS.WAREHOUSE_MANAGE,
    PERMISSIONS.PRICE_LIST_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.BARCODE_VIEW,
    PERMISSIONS.BARCODE_GENERATE,
    PERMISSIONS.BARCODE_PRINT,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  HR_MANAGER: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_UPDATE,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_MARK,
    // Security audit: hr-service's /attendance/report and /attendance/team-summary check
    // this separate constant, not ATTENDANCE_VIEW — this role could mark/view individual
    // attendance but never see the report or team summary.
    PERMISSIONS.ATTENDANCE_REPORT,
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_PROCESS,
    PERMISSIONS.SALARY_VIEW,
    PERMISSIONS.VIEW_SALARY_DETAILS,
    PERMISSIONS.HR_STATUTORY,
    PERMISSIONS.EMPLOYEE_LOAN_MANAGE,
    // Security audit: the whole Alterations module (hr-service's alteration.routes.ts, 10
    // endpoints) was unreachable — no ALTERATION_* constant was granted to this role at all.
    PERMISSIONS.ALTERATION_VIEW,
    PERMISSIONS.ALTERATION_CREATE,
    PERMISSIONS.ALTERATION_UPDATE,
    // See SALES_MANAGER's bulk-import comment above — same omission. EMPLOYEE_IMPORT is an
    // additional, entity-specific gate ImportEngine checks only for the employee entity type,
    // on top of the generic IMPORT_EXECUTE (see ImportEngine.ts's own comment) — HR_MANAGER
    // needs both to actually run an employee CSV import.
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_EXECUTE,
    PERMISSIONS.IMPORT_ROLLBACK,
    PERMISSIONS.EMPLOYEE_IMPORT,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  STAFF: [
    PERMISSIONS.INVOICE_VIEW,
    PERMISSIONS.QUOTATION_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  ACCOUNTANT_SUPERVISOR: [
    PERMISSIONS.ACCOUNT_VIEW,
    PERMISSIONS.ACCOUNT_CREATE,
    PERMISSIONS.ACCOUNT_UPDATE,
    PERMISSIONS.VOUCHER_CREATE,
    PERMISSIONS.VOUCHER_VIEW,
    PERMISSIONS.JOURNAL_VIEW,
    PERMISSIONS.JOURNAL_CREATE,
    PERMISSIONS.CANCEL_POSTED_JOURNAL,
    PERMISSIONS.LEDGER_VIEW,
    PERMISSIONS.LEDGER_EXPORT,
    PERMISSIONS.COST_CENTER_VIEW,
    PERMISSIONS.COST_CENTER_MANAGE,
    // See ACCOUNTANT's Payment Collection Report comment above — same omission.
    PERMISSIONS.PAYMENT_VIEW,
    // Security audit: this role held ZERO fixed-asset permissions even though the junior
    // ACCOUNTANT role already has all four — a supervisor couldn't even view an asset an
    // accountant registered. Same role-defaults.ts-omission pattern as migration 0076.
    PERMISSIONS.FIXED_ASSET_VIEW,
    PERMISSIONS.FIXED_ASSET_CREATE,
    PERMISSIONS.FIXED_ASSET_UPDATE,
    PERMISSIONS.FIXED_ASSET_DISPOSE,
    PERMISSIONS.BALANCE_SHEET_VIEW,
    PERMISSIONS.PROFIT_LOSS_VIEW,
    PERMISSIONS.TRIAL_BALANCE_VIEW,
    // Security audit: accounting-service's GET /reports/cash-flow checks this separate
    // constant, not the other three report-view permissions above (which this role already
    // held) — same role-defaults.ts-omission pattern as migration 0076.
    PERMISSIONS.CASH_FLOW_VIEW,
    PERMISSIONS.BANK_RECONCILIATION_VIEW,
    PERMISSIONS.BANK_RECONCILIATION_DO,
    PERMISSIONS.FINANCIAL_YEAR_VIEW,
    PERMISSIONS.GST_VIEW,
    PERMISSIONS.GST_FILE,
    PERMISSIONS.GSTR9_VIEW,
    PERMISSIONS.GSTR9_FILE,
    // See ACCOUNTANT's GSTR1/GSTR3B comment above — same omission.
    PERMISSIONS.GSTR1_VIEW,
    PERMISSIONS.GSTR1_FILE,
    PERMISSIONS.GSTR3B_VIEW,
    PERMISSIONS.GSTR3B_FILE,
    // Security audit: this role (senior to ACCOUNTANT — see FIXED_ASSET comment above) held
    // none of e-Invoice/e-Way Bill/GSTR-2A/GST-compute at all, despite the junior ACCOUNTANT
    // role holding all of them. Same omission pattern, mirrored here.
    PERMISSIONS.EINVOICE_GENERATE,
    PERMISSIONS.EINVOICE_CANCEL,
    PERMISSIONS.EWAY_BILL_GENERATE,
    PERMISSIONS.GSTR2A_RECONCILE,
    PERMISSIONS.GST_COMPUTE,
    // See ACCOUNTANT's TDS comment above — same omission.
    PERMISSIONS.TDS_VIEW,
    PERMISSIONS.TDS_MANAGE,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.AUDIT_LOG_VIEW,
    // PG-015: view-only distributed-systems console access, see ACCOUNTANT above.
    PERMISSIONS.DLQ_VIEW,
    PERMISSIONS.SAGA_VIEW,
    PERMISSIONS.SCHEMA_REGISTRY_VIEW,
    PERMISSIONS.PROJECTION_VIEW,
    PERMISSIONS.EVENT_STORE_VIEW,
    PERMISSIONS.PERFORMANCE_VIEW,
    // See SALES_MANAGER's EXPORT_GENERATE/EXPORT_VIEW comment above.
    PERMISSIONS.EXPORT_GENERATE,
    PERMISSIONS.EXPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  AUDITOR: [
    PERMISSIONS.INVOICE_VIEW,
    // See ACCOUNTANT's Payment Collection Report comment above — same omission; auditors
    // need to review collections as part of financial oversight.
    PERMISSIONS.PAYMENT_VIEW,
    PERMISSIONS.JOURNAL_VIEW,
    PERMISSIONS.LEDGER_VIEW,
    PERMISSIONS.LEDGER_EXPORT,
    PERMISSIONS.BALANCE_SHEET_VIEW,
    PERMISSIONS.PROFIT_LOSS_VIEW,
    PERMISSIONS.TRIAL_BALANCE_VIEW,
    PERMISSIONS.CASH_FLOW_VIEW,
    PERMISSIONS.GSTR9_VIEW,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.AUDIT_LOG_VIEW,
    PERMISSIONS.VIEW_AUDIT_LOG,
    // PG-015: view-only distributed-systems console access, see ACCOUNTANT above.
    PERMISSIONS.DLQ_VIEW,
    PERMISSIONS.SAGA_VIEW,
    PERMISSIONS.SCHEMA_REGISTRY_VIEW,
    PERMISSIONS.PROJECTION_VIEW,
    PERMISSIONS.EVENT_STORE_VIEW,
    PERMISSIONS.PERFORMANCE_VIEW,
    // See SALES_MANAGER's EXPORT_GENERATE/EXPORT_VIEW comment above.
    PERMISSIONS.EXPORT_GENERATE,
    PERMISSIONS.EXPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  DATA_OFFICER: [
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.EXPORT_CUSTOMER_DATA,
    // See SALES_MANAGER's bulk-import comment above — same omission, especially severe
    // here since this role's whole purpose is bulk data operations.
    PERMISSIONS.IMPORT_VIEW,
    PERMISSIONS.IMPORT_EXECUTE,
    PERMISSIONS.IMPORT_ROLLBACK,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    // See SALES_MANAGER's EXPORT_GENERATE/EXPORT_VIEW comment above — this role's whole
    // purpose is bulk data export, so the omission was especially severe here.
    PERMISSIONS.EXPORT_GENERATE,
    PERMISSIONS.EXPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
  ],

  SUPER_ADMIN: TENANT_SCOPED_PERMISSIONS,
};
