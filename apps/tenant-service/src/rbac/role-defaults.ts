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
          // Logging in as a customer is sensitive enough to reserve for OWNER/SUPER_ADMIN only,
          // same reasoning as IMPERSONATE_USER above (CRM-ROADMAP Phase 3, Feature 2).
          PERMISSIONS.IMPERSONATE_PORTAL_CUSTOMER,
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
    PERMISSIONS.CRM_360_VIEW,
    PERMISSIONS.CUSTOMER_CREATE,
    PERMISSIONS.CUSTOMER_EDIT,
    // H-3 fix: CUSTOMER_BLOCK was defined but never checked by any route (dead constant) —
    // now gates POST /customers/:id/block|unblock. See migration 0097 for the existing-tenant
    // backfill this role-defaults.ts change doesn't retroactively apply.
    PERMISSIONS.CUSTOMER_BLOCK,
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
    // CRM-ROADMAP Phase 1, Feature 1: SALES_MANAGER owns the Account/Contact hierarchy
    // (mirrors this role already owning CUSTOMER_CREATE/EDIT above). CRM_ACCOUNT_MERGE is
    // deliberately included here, not held back for a separate tier — this codebase's roles
    // don't have a SALES_MANAGER/SALES_REP split, and merge is exactly the kind of
    // credit-risk-adjacent decision this role already makes via CUSTOMER_BLOCK.
    PERMISSIONS.CRM_ACCOUNT_VIEW,
    PERMISSIONS.CRM_ACCOUNT_CREATE,
    PERMISSIONS.CRM_ACCOUNT_UPDATE,
    PERMISSIONS.CRM_ACCOUNT_MERGE,
    // CRM-ROADMAP Phase 1, Feature 2: SALES_MANAGER owns lead capture-through-conversion,
    // same reasoning as Feature 1's CRM_ACCOUNT_* grant above.
    PERMISSIONS.LEAD_VIEW,
    PERMISSIONS.LEAD_CREATE,
    PERMISSIONS.LEAD_UPDATE,
    PERMISSIONS.LEAD_ASSIGN,
    PERMISSIONS.LEAD_CONVERT,
    PERMISSIONS.LEAD_DELETE,
    // CRM-ROADMAP Phase 1, Feature 7: this role already holds the generic IMPORT_EXECUTE
    // above plus CRM_ACCOUNT_*/LEAD_* CRUD — without these two entity-specific gates,
    // ImportEngine.execute() would reject its account/lead CSV imports the same way
    // EMPLOYEE_IMPORT already gates employee rows.
    PERMISSIONS.CRM_ACCOUNT_IMPORT,
    PERMISSIONS.LEAD_IMPORT,
    // CRM-ROADMAP Phase 4, Feature 4: SALES_MANAGER owns Sales Ops admin configuration —
    // same reasoning as this role already owning the assignment-rule-adjacent LEAD_ASSIGN above.
    PERMISSIONS.TERRITORY_MANAGE,
    // CRM-ROADMAP Phase 4, Feature 5: SALES_MANAGER sets and reviews quotas, same Sales Ops
    // admin reasoning as TERRITORY_MANAGE immediately above.
    PERMISSIONS.QUOTA_MANAGE,
    PERMISSIONS.QUOTA_VALUE_VIEW,
    // CRM-ROADMAP Phase 4, Feature 3 — fixes a pre-existing gap found while implementing this
    // feature: CRM_SEASON_VIEW/MANAGE were never granted to any named role (only reachable via
    // OWNER/ADMIN/SUPER_ADMIN's TENANT_SCOPED_PERMISSIONS wildcard) — this system has no
    // dedicated "merchandiser" role, and SALES_MANAGER is the closest fit to review/approve a
    // festival suggestion, the same way it already owns every other CRM Sales Ops action above.
    PERMISSIONS.CRM_SEASON_VIEW,
    PERMISSIONS.CRM_SEASON_MANAGE,
    // CRM-ROADMAP Phase 4, Feature 1: SALES_MANAGER plans/assigns field-sales routes and has
    // tenant-wide visibility into every rep's field visits — same Sales Ops admin reasoning as
    // TERRITORY_MANAGE/QUOTA_MANAGE above. FIELD_VISIT_MANAGE also lets a SALES_MANAGER who is
    // themselves a field rep log their own visits (identity-scoped at the query layer).
    PERMISSIONS.FIELD_VISIT_MANAGE,
    PERMISSIONS.ROUTE_MANAGE,
    // CRM-ROADMAP Phase 4, Feature 7: SALES_MANAGER can click-to-call and view call history/
    // recordings — same Sales Ops admin reasoning as every other CRM_* grant above.
    PERMISSIONS.CALL_INITIATE,
    PERMISSIONS.CALL_LOG_VIEW,
    // CRM-ROADMAP Phase 1, Feature 4: SALES_MANAGER owns ticket handling end-to-end, same
    // reasoning as Features 1/2's CRM_ACCOUNT_*/LEAD_* grants above.
    PERMISSIONS.TICKET_VIEW,
    PERMISSIONS.TICKET_CREATE,
    PERMISSIONS.TICKET_UPDATE,
    PERMISSIONS.TICKET_ASSIGN,
    PERMISSIONS.TICKET_RESOLVE,
    PERMISSIONS.TICKET_DELETE,
    // CRM-ROADMAP Phase 1, Feature 8: the manager-facing rollup of the Lead/Ticket/Campaign
    // data this role already owns end-to-end above.
    PERMISSIONS.CRM_DASHBOARD_VIEW,
    // CRM-ROADMAP Phase 2, Feature 1: SALES_MANAGER owns the pipeline end-to-end, same
    // reasoning as every prior CRM feature grant above — this role already creates
    // quotations/invoices directly, so opportunity-to-quotation handoff is a natural extension.
    PERMISSIONS.OPPORTUNITY_VIEW,
    PERMISSIONS.OPPORTUNITY_CREATE,
    PERMISSIONS.OPPORTUNITY_UPDATE,
    PERMISSIONS.OPPORTUNITY_STAGE_CHANGE,
    PERMISSIONS.OPPORTUNITY_DELETE,
    // CRM-ROADMAP Phase 3, Feature 6: this role already sees comparable pricing data via
    // INVOICE_VIEW/QUOTATION_VIEW/PRICE_OVERRIDE above — preserves today's behavior exactly.
    PERMISSIONS.OPPORTUNITY_VALUE_VIEW,
    // CRM-ROADMAP Phase 2, Feature 2: this role already owns the CRM domain end-to-end
    // (accounts/leads/tickets/opportunities/dashboard above) — same reasoning extends to
    // journeys, including publishing one.
    PERMISSIONS.JOURNEY_VIEW,
    PERMISSIONS.JOURNEY_CREATE,
    PERMISSIONS.JOURNEY_PUBLISH,
    PERMISSIONS.JOURNEY_DELETE,
    // CRM-ROADMAP Phase 2, Feature 3: this role already effectively runs loyalty operations via
    // its POS_MANAGE grant above — LOYALTY_REDEEM/TIER_MANAGE make that explicit and specific
    // now that /pos/loyalty/redeem checks the granular constant instead of POS_MANAGE (see the
    // CASHIER grant below for the gap this closes: POS_MANAGE alone left every cashier unable to
    // redeem loyalty points at checkout despite running the till).
    PERMISSIONS.LOYALTY_TIER_MANAGE,
    PERMISSIONS.LOYALTY_REDEEM,
    // CRM-ROADMAP Phase 2, Feature 4: same "already owns the CRM domain end-to-end" reasoning
    // as every prior CRM feature grant above.
    PERMISSIONS.REFERRAL_VIEW,
    PERMISSIONS.REFERRAL_CONFIGURE,
    // CRM-ROADMAP Phase 2, Feature 5: same "already owns the CRM domain end-to-end" reasoning
    // as every prior CRM feature grant above.
    PERMISSIONS.CONVERSATION_VIEW,
    PERMISSIONS.CONVERSATION_REPLY,
    PERMISSIONS.CONVERSATION_ASSIGN,
    // RBAC audit 2026-07-31: a role-defaults-vs-route-guard cross-check found this role could
    // not reach the CRM Campaign/Segment surface at all (crm.routes.ts's CRM_VIEW gate covers
    // the campaign list, segment health, and automation-rule list endpoints) despite already
    // owning every other CRM sub-domain above (accounts/leads/tickets/opportunities/journeys/
    // loyalty/referrals/conversations/seasons). Same role-defaults.ts-omission pattern as every
    // other fix in this file — the Campaign Planning migrations (0053-0060) were never followed
    // up with a role-defaults.ts grant. Granted here: view, segment authoring, campaign
    // authoring/scheduling (create/edit/draft/submit-for-approval — NOT send), interaction
    // logging, automation-rule config, sender-identity, and DLT template management.
    // Deliberately NOT granted: CRM_CAMPAIGN_APPROVE / CRM_CAMPAIGN_SEND — crm.routes.ts
    // already has a distinct submit-for-approval -> approve -> send workflow, and bulk
    // customer-facing WhatsApp/SMS sends are DLT/TRAI-compliance-sensitive (see
    // NotificationEngine.sendRaw's hard gate) — segregation of duties (creator != approver)
    // for that specific step is being treated as intentional design, not a bug, pending
    // explicit product confirmation.
    PERMISSIONS.CRM_VIEW,
    PERMISSIONS.CRM_SEGMENT_VIEW,
    PERMISSIONS.CRM_SEGMENT_CREATE,
    PERMISSIONS.CRM_CAMPAIGN_CREATE,
    PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW,
    PERMISSIONS.CRM_INTERACTION_VIEW,
    PERMISSIONS.CRM_INTERACTION_CREATE,
    PERMISSIONS.CRM_AUTOMATION_MANAGE,
    PERMISSIONS.CRM_SENDER_IDENTITY_MANAGE,
    PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE,
    // RBAC audit 2026-07-31: sale-return.routes.ts's POST /credit-notes/:id/apply and
    // /credit-notes/:id/refund require CREDIT_NOTE_ADJUST specifically (not
    // CREDIT_NOTE_VIEW/CREATE, both already held above) — same "can create but never execute
    // the next lifecycle step" gap pattern documented throughout this file (e.g. PO_APPROVE,
    // GRN_APPROVE).
    PERMISSIONS.CREDIT_NOTE_ADJUST,
    // Business Rules Engine wiring: SALES_MANAGER needs read visibility into the
    // credit-limit/discount-approval rules that now actually govern their own domain's
    // invoice/quotation flows (see InvoiceService's new RuleEngine.evaluate() call), plus
    // Simulate to preview a rule change's effect before asking OWNER/ADMIN to create/edit it.
    // CRUD stays OWNER/ADMIN/SUPER_ADMIN-only (tenant-wide business policy config, same
    // posture as organizationSettings.purchaseApprovalThreshold), same split as this role's
    // existing config-vs-execution grants (e.g. LOYALTY_REDEEM without LOYALTY_TIER_MANAGE).
    PERMISSIONS.RULE_VIEW,
    PERMISSIONS.RULE_SIMULATE,
    // Commission engine: SALES_MANAGER views commission earned by their team and can approve
    // it for payout — same "owns the Sales domain end-to-end" reasoning as every other grant
    // in this role. Plan/assignment authoring (COMMISSION_MANAGE) stays OWNER/ADMIN-only,
    // matching the config-vs-execution split used for RULE_VIEW/RULE_SIMULATE above.
    PERMISSIONS.COMMISSION_VIEW,
    PERMISSIONS.COMMISSION_APPROVE,
    // Workflow Automation Engine: same "views/simulates config affecting their domain, but
    // authoring stays OWNER/ADMIN-only" split as RULE_VIEW/RULE_SIMULATE above.
    PERMISSIONS.AUTOMATION_VIEW,
    PERMISSIONS.AUTOMATION_EXECUTE,
    // AI Copilot: gates the feature itself, not the data it can read — safe to grant broadly
    // to operational roles since every tool call still inherits the caller's own RBAC.
    PERMISSIONS.COPILOT_VIEW,
    PERMISSIONS.COPILOT_USE,
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
    PERMISSIONS.CRM_360_VIEW,
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
    // CRM-ROADMAP Phase 2, Feature 3: real gap found — /pos/loyalty/redeem was gated on
    // POS_MANAGE only, which CASHIER deliberately does NOT hold (see the comment above on
    // POS_CASH_DRAWER). That made loyalty-point redemption at checkout a supervisor-only action
    // despite the roadmap's own explicit requirement that redemption be "cashier-permitted but
    // not cashier-configurable." LOYALTY_REDEEM (POS-facing) is granted here; LOYALTY_TIER_MANAGE
    // (config-facing) deliberately is not.
    PERMISSIONS.LOYALTY_REDEEM,
    // CRM-ROADMAP Phase 2, Feature 4: a cashier printing a receipt needs to fetch (get-or-create)
    // the paying customer's own referral code for the receipt QR — the same "cashier-permitted,
    // not cashier-configurable" split as LOYALTY_REDEEM/TIER_MANAGE above. REFERRAL_CONFIGURE
    // (code deactivation, fraud-review) is deliberately not granted here.
    PERMISSIONS.REFERRAL_VIEW,
  ],

  PURCHASE_MANAGER: [
    // Purchase audit 2026-07-21 gap-fix: Requisition -> RFQ/Quotation -> PO -> Invoice-match
    // are new upstream/downstream stages of this role's existing PO/GRN ownership.
    PERMISSIONS.REQUISITION_VIEW,
    PERMISSIONS.REQUISITION_CREATE,
    PERMISSIONS.REQUISITION_APPROVE,
    PERMISSIONS.REQUISITION_CONVERT,
    PERMISSIONS.RFQ_VIEW,
    PERMISSIONS.RFQ_CREATE,
    PERMISSIONS.SUPPLIER_QUOTATION_CREATE,
    PERMISSIONS.SUPPLIER_QUOTATION_COMPARE,
    PERMISSIONS.PURCHASE_INVOICE_VIEW,
    PERMISSIONS.PURCHASE_INVOICE_CREATE,
    PERMISSIONS.PURCHASE_INVOICE_APPROVE,
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
    // Purchase audit 2026-07-21: this role owns supplier CRUD but couldn't view a supplier's
    // running-balance statement (supplier-payment.routes.ts's GET /suppliers/:id/statement
    // checks this separate constant) — same role-defaults.ts-omission pattern documented
    // throughout this file.
    PERMISSIONS.SUPPLIER_STATEMENT_VIEW,
    // Purchase audit 2026-07-21: PurchaseOrderService.approve() lets an approver override a
    // blocked vendor-credit-limit check, but only if they also hold this constant
    // (purchase-order.routes.ts's inline check) — it was granted only to SALES_MANAGER (for
    // the unrelated invoice-credit-limit use case) and OWNER/ADMIN/SUPER_ADMIN, so a
    // PURCHASE_MANAGER could never override their own module's credit-limit block.
    PERMISSIONS.CREDIT_LIMIT_OVERRIDE,
    // Purchase audit 2026-07-21: expense.routes.ts's whole Expense module (freight/other
    // purchase-related charges) was unreachable for this role — it owns the rest of
    // purchasing but had zero EXPENSE_* permissions.
    PERMISSIONS.EXPENSE_VIEW,
    PERMISSIONS.EXPENSE_CREATE,
    PERMISSIONS.EXPENSE_APPROVE,
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
    // Business Rules Engine wiring: same reasoning as SALES_MANAGER's RULE_VIEW/RULE_SIMULATE
    // grant above — this role's PO approval-threshold and GRN-PO-match checks now run through
    // RuleEngine.evaluate(), so it needs read+simulate visibility into rules governing its own
    // domain. CRUD stays OWNER/ADMIN/SUPER_ADMIN-only.
    PERMISSIONS.RULE_VIEW,
    PERMISSIONS.RULE_SIMULATE,
    // Workflow Automation Engine: same reasoning as SALES_MANAGER's grant above.
    PERMISSIONS.AUTOMATION_VIEW,
    PERMISSIONS.AUTOMATION_EXECUTE,
    // AI Copilot: same reasoning as SALES_MANAGER's grant above.
    PERMISSIONS.COPILOT_VIEW,
    PERMISSIONS.COPILOT_USE,
  ],

  ACCOUNTANT: [
    PERMISSIONS.ACCOUNT_VIEW,
    PERMISSIONS.ACCOUNT_CREATE,
    // Security audit (docs-site's own accounting architecture audit page): accounts.routes.ts
    // gates both PUT /accounts/:id and DELETE /accounts/:id on ACCOUNT_UPDATE — this role
    // could create an account but never edit or delete one afterward.
    PERMISSIONS.ACCOUNT_UPDATE,
    PERMISSIONS.VOUCHER_CREATE,
    PERMISSIONS.JOURNAL_VIEW,
    PERMISSIONS.JOURNAL_CREATE,
    PERMISSIONS.LEDGER_VIEW,
    PERMISSIONS.COST_CENTER_VIEW,
    // Same audit: this role couldn't view any of the four core financial reports
    // (Trial Balance/P&L/Balance Sheet/Cash Flow) despite being the one entering the
    // underlying journal/account data — ACCOUNTANT_SUPERVISOR/AUDITOR already hold these.
    PERMISSIONS.BALANCE_SHEET_VIEW,
    PERMISSIONS.PROFIT_LOSS_VIEW,
    PERMISSIONS.TRIAL_BALANCE_VIEW,
    PERMISSIONS.CASH_FLOW_VIEW,
    // Same audit: report-service's Bank Book report is gated on BANK_RECONCILIATION_VIEW,
    // which only ACCOUNTANT_SUPERVISOR held — view-only here (the actual reconciliation
    // action, BANK_RECONCILIATION_DO, stays supervisor-tier).
    PERMISSIONS.BANK_RECONCILIATION_VIEW,
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
    // Purchase audit 2026-07-21: expense.routes.ts's approve step checks EXPENSE_APPROVE
    // separately from EXPENSE_VIEW/CREATE — this role (and PURCHASE_MANAGER) held the first
    // two but not this one, so EXPENSE_APPROVE was granted to nobody but OWNER/ADMIN/
    // SUPER_ADMIN and the expense-approval workflow was practically unreachable day-to-day.
    PERMISSIONS.EXPENSE_APPROVE,
    // Purchase audit 2026-07-21: same SUPPLIER_STATEMENT_VIEW omission as PURCHASE_MANAGER
    // above — this role holds PAYMENT_OUT_VIEW but couldn't view the statement it summarizes.
    PERMISSIONS.SUPPLIER_STATEMENT_VIEW,
    // Purchase audit 2026-07-21: the new PO/GRN-vs-supplier-invoice variance record is
    // exactly the kind of AP reconciliation document this role needs to see before a
    // payment goes out, even though it doesn't create/approve the match itself.
    PERMISSIONS.PURCHASE_INVOICE_VIEW,
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
    // Inventory module audit 2026-07-21: this role held none of the granular inventory
    // *_VIEW constants report-service's inventory reports gate on (Stock Ledger, Warehouse-
    // wise Stock, Dead Stock, Physical Verification, Stock Transfer, Stock Adjustment,
    // Fabric Roll) — despite inventory value feeding straight into the Balance Sheet this
    // role is explicitly permissioned to view/prepare. View-only; no adjust/transfer/manage.
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.WAREHOUSE_VIEW,
    PERMISSIONS.STOCK_ADJUSTMENT_VIEW,
    PERMISSIONS.STOCK_TRANSFER_VIEW,
    PERMISSIONS.PHYSICAL_VERIFICATION_VIEW,
    PERMISSIONS.FABRIC_ROLL_VIEW,
    // AI Copilot: same reasoning as SALES_MANAGER's grant above.
    PERMISSIONS.COPILOT_VIEW,
    PERMISSIONS.COPILOT_USE,
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
    // AI Copilot: same reasoning as SALES_MANAGER's grant above.
    PERMISSIONS.COPILOT_VIEW,
    PERMISSIONS.COPILOT_USE,
  ],

  HR_MANAGER: [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_UPDATE,
    // 2026-07-20 HR audit: department/designation DELETE routes check this separate
    // constant, not EMPLOYEE_UPDATE — this role could create/edit but never delete one.
    PERMISSIONS.EMPLOYEE_DELETE,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_MARK,
    // Security audit: hr-service's /attendance/report and /attendance/team-summary check
    // this separate constant, not ATTENDANCE_VIEW — this role could mark/view individual
    // attendance but never see the report or team summary.
    PERMISSIONS.ATTENDANCE_REPORT,
    // 2026-07-20 HR audit: PUT /attendance/:id/correct checks this separate constant —
    // without it this role could mark attendance but never correct a mistaken entry.
    PERMISSIONS.ATTENDANCE_CORRECT,
    PERMISSIONS.LEAVE_VIEW,
    // 2026-07-20 HR audit: this role runs day-to-day HR, including applying for its own
    // leave — LEAVE_APPLY was previously granted to nobody but OWNER/ADMIN/SUPER_ADMIN.
    PERMISSIONS.LEAVE_APPLY,
    PERMISSIONS.LEAVE_APPROVE,
    // 2026-07-20 HR audit: POST /leave-applications/:id/reject checks this separate
    // constant — this role held LEAVE_APPROVE but could only ever approve, never reject.
    PERMISSIONS.LEAVE_REJECT,
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_PROCESS,
    // 2026-07-20 HR audit: SALARY_VIEW is a dead constant no route ever checks (superseded
    // by VIEW_SALARY_DETAILS below) — dropped rather than carried forward.
    PERMISSIONS.VIEW_SALARY_DETAILS,
    // 2026-07-20 HR audit: POST /payroll-runs/:id/approve, /disburse, and /bulk-send all
    // check this separate constant — this role could create and calculate a payroll run
    // (PAYROLL_PROCESS) but never approve, disburse, or send the slips it just calculated.
    PERMISSIONS.PAYROLL_APPROVE,
    // 2026-07-20 HR audit: GET /payroll-slips/:id/pdf checks this separate constant — this
    // role could view salary details but never print/download the payslip PDF.
    PERMISSIONS.SALARY_SLIP_PRINT,
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
    // 2026-07-20 HR audit: this role's routes gate on this constant (holiday.routes.ts's
    // entire file) — despite the "HR Manager" name, it could not view/create/delete/seed
    // the Holiday Calendar at all.
    PERMISSIONS.HR_MANAGE,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.SEARCH_GLOBAL,
    // AI Copilot: same reasoning as SALES_MANAGER's grant above.
    PERMISSIONS.COPILOT_VIEW,
    PERMISSIONS.COPILOT_USE,
  ],

  STAFF: [
    PERMISSIONS.INVOICE_VIEW,
    PERMISSIONS.QUOTATION_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.CRM_360_VIEW,
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.LEAVE_VIEW,
    // 2026-07-20 HR audit: STAFF is the general non-manager employee role — without
    // LEAVE_APPLY (previously granted to nobody but OWNER/ADMIN/SUPER_ADMIN) an ordinary
    // employee could view their leave balance but never actually apply for or cancel leave.
    PERMISSIONS.LEAVE_APPLY,
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
    // See ACCOUNTANT's inventory-view comment above — same omission, one tier up.
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.WAREHOUSE_VIEW,
    PERMISSIONS.STOCK_ADJUSTMENT_VIEW,
    PERMISSIONS.STOCK_TRANSFER_VIEW,
    PERMISSIONS.PHYSICAL_VERIFICATION_VIEW,
    PERMISSIONS.FABRIC_ROLL_VIEW,
  ],

  AUDITOR: [
    PERMISSIONS.INVOICE_VIEW,
    // See ACCOUNTANT's Payment Collection Report comment above — same omission; auditors
    // need to review collections as part of financial oversight.
    PERMISSIONS.PAYMENT_VIEW,
    // Purchase audit 2026-07-21: this role — whose entire purpose is financial oversight —
    // had zero visibility into any purchase-side document (PO/GRN/return/supplier payment/
    // supplier record). It could review sales invoices and journals but not the purchase
    // half of the books at all. View-only, matching this role's read-only posture elsewhere.
    PERMISSIONS.PO_VIEW,
    PERMISSIONS.GRN_VIEW,
    PERMISSIONS.PURCHASE_RETURN_VIEW,
    PERMISSIONS.PAYMENT_OUT_VIEW,
    PERMISSIONS.SUPPLIER_VIEW,
    PERMISSIONS.SUPPLIER_STATEMENT_VIEW,
    // Purchase audit 2026-07-21: requisition/RFQ/invoice-match are new stages of the same
    // purchase-side paper trail this role already reviews above — view-only, same posture.
    PERMISSIONS.REQUISITION_VIEW,
    PERMISSIONS.RFQ_VIEW,
    PERMISSIONS.PURCHASE_INVOICE_VIEW,
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
    // Inventory module audit 2026-07-21: this role — whose entire purpose is financial
    // oversight — had zero visibility into inventory stock/valuation reports despite them
    // feeding directly into the Balance Sheet it's explicitly permissioned to review. Same
    // omission pattern as the purchase-side PO/GRN/supplier fix above.
    PERMISSIONS.ITEM_VIEW,
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.WAREHOUSE_VIEW,
    PERMISSIONS.STOCK_ADJUSTMENT_VIEW,
    PERMISSIONS.STOCK_TRANSFER_VIEW,
    PERMISSIONS.PHYSICAL_VERIFICATION_VIEW,
    PERMISSIONS.FABRIC_ROLL_VIEW,
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
