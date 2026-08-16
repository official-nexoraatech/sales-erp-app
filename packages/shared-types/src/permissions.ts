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

  // ── Purchase Requisitions ─────────────────────────────────────────────────
  REQUISITION_VIEW: 'REQUISITION_VIEW',
  REQUISITION_CREATE: 'REQUISITION_CREATE',
  REQUISITION_APPROVE: 'REQUISITION_APPROVE',
  REQUISITION_CONVERT: 'REQUISITION_CONVERT',

  // ── RFQ / Supplier Quotations (distinct from the sales-side QUOTATION_* above, which
  // gate customer-facing sales quotations, not supplier-facing procurement ones) ────────
  RFQ_VIEW: 'RFQ_VIEW',
  RFQ_CREATE: 'RFQ_CREATE',
  SUPPLIER_QUOTATION_CREATE: 'SUPPLIER_QUOTATION_CREATE',
  SUPPLIER_QUOTATION_COMPARE: 'SUPPLIER_QUOTATION_COMPARE',

  // ── Purchase Invoices (PO/GRN variance match) ────────────────────────────
  PURCHASE_INVOICE_VIEW: 'PURCHASE_INVOICE_VIEW',
  PURCHASE_INVOICE_CREATE: 'PURCHASE_INVOICE_CREATE',
  PURCHASE_INVOICE_APPROVE: 'PURCHASE_INVOICE_APPROVE',

  // ── Purchase Orders ───────────────────────────────────────────────────────
  PO_VIEW: 'PO_VIEW',
  PO_CREATE: 'PO_CREATE',
  PO_UPDATE: 'PO_UPDATE',
  PO_APPROVE: 'PO_APPROVE',
  // Tiered approval (purchase-module enhancement 2026-07-21): required, in addition to
  // PO_APPROVE, to approve a PO above the tenant's configured purchaseApprovalThreshold
  // (organization_settings.purchase_approval_threshold) — same escalation pattern as
  // CREDIT_LIMIT_OVERRIDE below.
  PO_APPROVE_HIGH_VALUE: 'PO_APPROVE_HIGH_VALUE',
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
  // CRM-ROADMAP Phase 1, Feature 1 (Contact & Account Hierarchy): named CRM_ACCOUNT_* rather
  // than the roadmap doc's literal ACCOUNT_VIEW/CREATE/UPDATE — those three already exist
  // above (§"Accounting") gating the Chart of Accounts, an unrelated resource. Reusing them
  // would have silently overwritten that grant instead of adding a new one.
  CRM_ACCOUNT_VIEW: 'CRM_ACCOUNT_VIEW',
  CRM_ACCOUNT_CREATE: 'CRM_ACCOUNT_CREATE',
  CRM_ACCOUNT_UPDATE: 'CRM_ACCOUNT_UPDATE',
  // Merge is higher-risk than create/update (re-points every contact and customer under the
  // source account) — restricted to SALES_MANAGER+ in role-defaults.ts, not granted alongside
  // the other three CRM_ACCOUNT_* constants to every role that gets those.
  CRM_ACCOUNT_MERGE: 'CRM_ACCOUNT_MERGE',
  // CRM-ROADMAP Phase 1, Feature 7 (Data Import/Dedupe/Merge Tooling): entity-specific import
  // gate, same layering precedent as CUSTOMER_IMPORT/EMPLOYEE_IMPORT — the generic
  // IMPORT_EXECUTE gates the route, this gates the entity type within ImportEngine.execute().
  CRM_ACCOUNT_IMPORT: 'CRM_ACCOUNT_IMPORT',
  // CRM-ROADMAP Phase 1, Feature 2 (Lead Management & Capture). No naming collision found
  // for the LEAD_* namespace (unlike Feature 1's ACCOUNT_* — see above).
  LEAD_VIEW: 'LEAD_VIEW',
  LEAD_CREATE: 'LEAD_CREATE',
  LEAD_UPDATE: 'LEAD_UPDATE',
  LEAD_ASSIGN: 'LEAD_ASSIGN',
  LEAD_CONVERT: 'LEAD_CONVERT',
  LEAD_DELETE: 'LEAD_DELETE',
  // CRM-ROADMAP Phase 1, Feature 7: same reasoning as CRM_ACCOUNT_IMPORT above.
  LEAD_IMPORT: 'LEAD_IMPORT',
  // CRM-ROADMAP Phase 1, Feature 3 (Customer 360 Command Center). Gates the single composed
  // GET /customers/:id/360 endpoint — granted to the same roles that already hold
  // CUSTOMER_VIEW (it's a read-only, richer view of data those roles can already see
  // piecemeal via /statement, /outstanding, /activity).
  CRM_360_VIEW: 'CRM_360_VIEW',
  // CRM-ROADMAP Phase 1, Feature 4 (Support & Ticketing). No naming collision found for the
  // TICKET_* namespace.
  TICKET_VIEW: 'TICKET_VIEW',
  TICKET_CREATE: 'TICKET_CREATE',
  TICKET_UPDATE: 'TICKET_UPDATE',
  TICKET_ASSIGN: 'TICKET_ASSIGN',
  TICKET_RESOLVE: 'TICKET_RESOLVE',
  TICKET_DELETE: 'TICKET_DELETE',
  // CRM-ROADMAP Phase 1, Feature 6 (DLT/TRAI SMS Compliance). A single coarse constant
  // (view/create/update/delete of registered DLT templates) — admin-only config surface per
  // the phase doc, same precedent as SSO_CONFIG_MANAGE/BRANCH_MANAGE rather than four
  // granular CRUD constants.
  CRM_DLT_TEMPLATE_MANAGE: 'CRM_DLT_TEMPLATE_MANAGE',
  // CRM-ROADMAP Phase 1, Feature 8 (CRM Dashboards & KPI Tracking). Named CRM_DASHBOARD_VIEW
  // rather than the roadmap doc's implied bare DASHBOARD_VIEW — that already exists above
  // (§"Dashboard") gating report-service's unrelated org-wide KPI dashboard. Same
  // disambiguation reasoning as CRM_ACCOUNT_VIEW vs. Chart-of-Accounts' ACCOUNT_VIEW.
  CRM_DASHBOARD_VIEW: 'CRM_DASHBOARD_VIEW',
  // CRM-ROADMAP Phase 2, Feature 1 (Sales Pipeline & Opportunity Management). No naming
  // collision found for the OPPORTUNITY_* namespace (no HR/recruitment "job opening" feature
  // uses it). Deal value is commercially sensitive but every role that gets OPPORTUNITY_VIEW
  // already sees comparable pricing data via INVOICE_VIEW/QUOTATION_VIEW — no separate
  // value-redaction permission introduced.
  OPPORTUNITY_VIEW: 'OPPORTUNITY_VIEW',
  OPPORTUNITY_CREATE: 'OPPORTUNITY_CREATE',
  OPPORTUNITY_UPDATE: 'OPPORTUNITY_UPDATE',
  // Stage changes into Won/Lost have real side effects (quotation auto-creation, permanent
  // loss-reason record) — gated separately from a plain field-edit UPDATE, same reasoning as
  // Feature 1's CRM_ACCOUNT_MERGE being split out from CRM_ACCOUNT_UPDATE.
  OPPORTUNITY_STAGE_CHANGE: 'OPPORTUNITY_STAGE_CHANGE',
  OPPORTUNITY_DELETE: 'OPPORTUNITY_DELETE',
  // CRM-ROADMAP Phase 3, Feature 6 (Field-level RBAC for CRM Records) — the field-level
  // permission this feature's objective calls out by name: today every role holding
  // OPPORTUNITY_VIEW also holds INVOICE_VIEW/QUOTATION_VIEW/PRICE_OVERRIDE (verified against
  // role-defaults.ts, not assumed), so nothing changes for the current 10 system roles. This
  // exists so a future tenant-created custom role can be granted OPPORTUNITY_VIEW (see the
  // deal's stage/pipeline position) without also seeing the commercially sensitive `value`
  // field — response-serialization filter, not a route gate (see
  // packages/platform-sdk/src/field-visibility.ts).
  OPPORTUNITY_VALUE_VIEW: 'OPPORTUNITY_VALUE_VIEW',
  // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal). PORTAL_ACCOUNT_MANAGE gates
  // staff provisioning of a customer's portal login (POST /customers/:id/portal-account).
  // IMPERSONATE_PORTAL_CUSTOMER is kept separate from the existing IMPERSONATE_USER — logging
  // in as a customer is a distinct, still-sensitive action from impersonating another staff
  // member, and conflating the two would let an IMPERSONATE_USER grant silently reach the new
  // customer-facing surface too.
  PORTAL_ACCOUNT_MANAGE: 'PORTAL_ACCOUNT_MANAGE',
  IMPERSONATE_PORTAL_CUSTOMER: 'IMPERSONATE_PORTAL_CUSTOMER',
  // CRM-ROADMAP Phase 4, Feature 4 (Territory Management). No naming collision found for the
  // TERRITORY_* namespace (repo-wide grep). One constant gates CRUD on territories themselves
  // plus branch/user assignment into them — a Sales Ops admin action, not something split into
  // separate create/update/delete grants like customer-facing entities (CRM_ACCOUNT_* etc.).
  TERRITORY_MANAGE: 'TERRITORY_MANAGE',
  // CRM-ROADMAP Phase 4, Feature 5 (Sales Forecasting & Quota Management). No naming collision
  // found for QUOTA_* (QUOTATION_*/SUPPLIER_QUOTATION_* are a distinct, unrelated document-type
  // namespace, already noted as such where those are defined). QUOTA_MANAGE gates CRUD on quota
  // records themselves, same "Sales Ops admin action" reasoning as TERRITORY_MANAGE above.
  // QUOTA_VALUE_VIEW is the field-level gate on the quota/actual $ amounts and attainment %
  // within the dashboard rollup — same precedent as OPPORTUNITY_VALUE_VIEW (a derived aggregate
  // computed from a sensitive figure carries the same sensitivity as the raw figure itself).
  QUOTA_MANAGE: 'QUOTA_MANAGE',
  QUOTA_VALUE_VIEW: 'QUOTA_VALUE_VIEW',
  // CRM-ROADMAP Phase 4, Feature 8 (Public CRM API & BI/Data-Warehouse Export). No naming
  // collision found for API_KEY_*. Deliberately reserved for OWNER/ADMIN/SUPER_ADMIN only (via
  // TENANT_SCOPED_PERMISSIONS, no explicit SALES_MANAGER grant) — issuing a credential that can
  // pull CRM data out of the system entirely is a platform-governance action, same sensitivity
  // tier as IMPERSONATE_USER/IMPERSONATE_PORTAL_CUSTOMER above, not a day-to-day Sales Ops
  // action like TERRITORY_MANAGE/QUOTA_MANAGE. Export-schedule CRUD reuses the pre-existing
  // EXPORT_GENERATE/EXPORT_VIEW permissions rather than inventing new ones — a recurring
  // schedule is the same underlying action class as the existing one-shot export.
  API_KEY_MANAGE: 'API_KEY_MANAGE',
  // CRM-ROADMAP Phase 4, Feature 7 (CTI / Call Center Integration). No naming collision found
  // for CALL_*. CALL_INITIATE gates click-to-call (a rep dialing out) separately from
  // CALL_LOG_VIEW (viewing call history/recordings) — recordings are sensitive enough to
  // warrant the same view/action split as, e.g., QUOTA_VALUE_VIEW vs QUOTA_MANAGE, rather than
  // one combined permission.
  CALL_INITIATE: 'CALL_INITIATE',
  CALL_LOG_VIEW: 'CALL_LOG_VIEW',
  // CRM-ROADMAP Phase 4, Feature 1 (Field Sales / Distributor CRM). No naming collision found
  // for FIELD_VISIT_*/ROUTE_MANAGE. FIELD_VISIT_MANAGE gates a rep logging/checking-out their
  // OWN visits (identity-scoped by repUserId at the query layer, not a separate role — this
  // codebase has no distinct "field rep" role, reps are SALES_MANAGER-scoped users per
  // role-defaults.ts). ROUTE_MANAGE gates route planning/assignment and tenant-wide visit/route
  // visibility for distribution managers — deliberately no manager-hierarchy scoping (no such
  // concept exists in this codebase); a ROUTE_MANAGE holder sees every rep's visits tenant-wide,
  // same "no partial-tenant admin view" precedent as TERRITORY_MANAGE/QUOTA_MANAGE.
  FIELD_VISIT_MANAGE: 'FIELD_VISIT_MANAGE',
  ROUTE_MANAGE: 'ROUTE_MANAGE',
  // CRM-ROADMAP Phase 2, Feature 2 (Visual Customer Journey Builder). No naming collision
  // found for JOURNEY_*. Publish is gated separately from create/edit — same
  // "state-transition action with real blast-radius, gated apart from authoring" reasoning as
  // CRM_CAMPAIGN_APPROVE (a published journey can affect a large customer segment at scale,
  // continuously, not a one-time send) — JOURNEY_CREATE covers both create and edit-while-DRAFT,
  // matching CRM_CAMPAIGN_CREATE's existing precedent of gating a campaign's PUT route too.
  JOURNEY_VIEW: 'JOURNEY_VIEW',
  JOURNEY_CREATE: 'JOURNEY_CREATE',
  JOURNEY_PUBLISH: 'JOURNEY_PUBLISH',
  JOURNEY_DELETE: 'JOURNEY_DELETE',
  // CRM-ROADMAP Phase 2, Feature 3 (Loyalty & Rewards Tiering). CRM_LOYALTY_VIEW/ADJUST already
  // exist but are dead constants (see packages/shared-types/src/__tests__/dead-permission-
  // constants.test.ts's own KNOWN exceptions list) — not reused here, since the roadmap names
  // these two specifically and gives them a real intended split: redemption is cashier-permitted
  // (low-privilege, POS-facing) while tier/catalog config is a separate, higher-privilege grant,
  // exactly the CRM_CAMPAIGN_CREATE-vs-CRM_CAMPAIGN_APPROVE precedent.
  LOYALTY_TIER_MANAGE: 'LOYALTY_TIER_MANAGE',
  LOYALTY_REDEEM: 'LOYALTY_REDEEM',
  // CRM-ROADMAP Phase 2, Feature 4 (Referral Program Engine). Names taken directly from the
  // roadmap's own Security Considerations section. REFERRAL_CONFIGURE covers both generating/
  // deactivating a customer's code and reviewing FLAGGED (fraud-suspected) rewards — one grant,
  // same reasoning as CRM_AUTOMATION_MANAGE covering several related admin actions.
  REFERRAL_VIEW: 'REFERRAL_VIEW',
  REFERRAL_CONFIGURE: 'REFERRAL_CONFIGURE',
  // CRM-ROADMAP Phase 2, Feature 5 (Omnichannel Communication Hub). Names taken directly from
  // the roadmap's own Security Considerations section. ASSIGN is gated separately from REPLY —
  // same "state-transition action gated apart from the day-to-day action" reasoning as
  // JOURNEY_PUBLISH/CRM_CAMPAIGN_APPROVE — assigning a conversation changes whose queue it's in
  // for everyone, not just this replier's own view of it.
  CONVERSATION_VIEW: 'CONVERSATION_VIEW',
  CONVERSATION_REPLY: 'CONVERSATION_REPLY',
  CONVERSATION_ASSIGN: 'CONVERSATION_ASSIGN',

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
  // NOTIFICATION_VIEW retired 2026-07-23 (notification-service audit, PG-014 pattern): a
  // tenant user's own in-app notifications (GET /notifications) are identity-scoped by
  // recipientUserId, not permission-gated — there was never a "view other users' notifications"
  // feature for this constant to gate. NOTIFICATION_CONFIG is kept — see the notification
  // template-management API this audit adds, which wires it up for real.
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

  // ── Commission ────────────────────────────────────────────────────────────
  COMMISSION_VIEW: 'COMMISSION_VIEW',
  COMMISSION_MANAGE: 'COMMISSION_MANAGE', // create/edit plans and assignments
  COMMISSION_APPROVE: 'COMMISSION_APPROVE', // DRAFT -> APPROVED, triggers GL posting

  // ── Workflow Automation Engine (automation-service) ────────────────────────
  AUTOMATION_VIEW: 'AUTOMATION_VIEW',
  AUTOMATION_CREATE: 'AUTOMATION_CREATE',
  AUTOMATION_EDIT: 'AUTOMATION_EDIT',
  AUTOMATION_DELETE: 'AUTOMATION_DELETE',
  AUTOMATION_EXECUTE: 'AUTOMATION_EXECUTE', // manual trigger + API-key trigger

  // ── AI Copilot (ai-copilot-service) ─────────────────────────────────────────
  // Gates access to the Copilot feature itself only — data access within a conversation is
  // still bounded by whatever RBAC the requesting user already has on the APIs its tools call.
  COPILOT_VIEW: 'COPILOT_VIEW',
  COPILOT_USE: 'COPILOT_USE',

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

  // ── Multi-vertical platform audit 2026-08-16, Phase 2 — multi-buy/BOGO pricing promotions ──
  PROMOTION_VIEW: 'PROMOTION_VIEW',
  PROMOTION_MANAGE: 'PROMOTION_MANAGE',

  // ── Platform-level permissions — cross-tenant, not scoped to request.auth.tenantId. ──
  // Only assignable to a platform-operator role, never a tenant's own Owner/Admin role.
  PLATFORM_TENANT_MANAGE: 'PLATFORM_TENANT_MANAGE',
  // Manage the public marketing site's FAQ content (faq_items — global, not tenant-scoped).
  // Platform-operator only, like PLATFORM_TENANT_MANAGE, since this is platform content.
  PLATFORM_CONTENT_MANAGE: 'PLATFORM_CONTENT_MANAGE',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
