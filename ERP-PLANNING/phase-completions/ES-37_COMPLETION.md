# ES-37 Completion Report — RBAC Audit Phase D: Frontend UI-Level Permission Gating
**Date:** 2026-07-04
**Status:** COMPLETE

## What Was Done

Rolled out the `canX = hasPermission(PERMISSIONS.X)` pattern (already used correctly in
`PayrollPage.tsx`/`EmployeesPage.tsx`/`CustomerViewPage.tsx`) to every remaining
create/edit/delete/approve/reject/dispatch/export/file/pay/cancel action across:
`sales/` (Invoices, Quotations, Payments, SaleReturns, DeliveryChallans + their detail
pages), `purchase/` (PurchaseOrders, GRNs, SupplierPayments, PurchaseReturns, Expenses),
`accounting/` (Journals, ChartOfAccounts, FixedAssets + detail, FinancialYears,
BankReconciliation), `gst/` (EInvoice, Gstr1, Gstr3b, GSTR9, GstCompliance), `inventory/`
(FabricRolls), `items/` (Items, Categories, Brands, Units, PriceLists), `settings/`
(Branches, Warehouses, Organization), `users/` (Users), `suppliers/` (Suppliers).

**Skipped deliberately, not overlooked:**
- Pure read-only reports with no actions: `BalanceSheetPage`, `CashFlowPage`,
  `ProfitLossPage`, `TrialBalancePage`, `LedgerPage`, `TDSPage`.
- Pages where the backend enforces one single permission for the entire feature,
  including the route guard itself: `GstConfigPage`, `Gstr2aPage`, `GstRegisterPage`,
  `StockTransfersPage`/`StockAdjustmentsPage`/`PhysicalVerificationPage` (transfer/
  adjustment/physical-verification routes all check only `WAREHOUSE_MANAGE`, confirmed in
  ES-34's research — per-button gating there would be redundant, not missing).
- Form pages reached only via an already-permission-gated create/edit route
  (`InvoiceFormPage`, `PurchaseOrderFormPage`, `GRNCreatePage`, etc.) — their internal
  Save/Submit doesn't need re-gating since the whole page requires the same permission
  to reach in the first place.

## Real Bugs Found While Gating (not just missing UI polish)

Checking each button against the backend's *actual* enforced permission (rather than
assuming the page's route-level permission applies to every action on it) surfaced the
same "two similarly-named permissions, wrong one wired up" bug class ES-35 found in
`CUSTOMER_UPDATE`/`CUSTOMER_EDIT` — **three more times**:

| Constant pair | Real-world effect | Fix |
|---|---|---|
| `ITEM_UPDATE` (route-level + `role-defaults.ts`) vs `ITEM_EDIT` (backend `PUT /items/:id`) | `INVENTORY_MANAGER` could open the item edit form but every save 403'd | `App.tsx` route + `INVENTORY_MANAGER`'s role-defaults switched to `ITEM_EDIT` |
| `SUPPLIER_UPDATE` (route-level + `role-defaults.ts`) vs `SUPPLIER_EDIT` (backend `PUT /suppliers/:id`) | `PURCHASE_MANAGER` could open the supplier edit form but every save 403'd | Same fix pattern, `SUPPLIER_EDIT` |
| `ORGANIZATION_SETTINGS_VIEW` (route) vs `ORG_SETTINGS_EDIT` (backend `PUT /organization`) | Not a role-defaults bug (neither is explicitly assigned to a named role — only `OWNER`/`ADMIN` get `ORG_SETTINGS_EDIT` via their full permission set), but confirmed the same naming-collision pattern; Save button now gated on the correct constant |

**A fourth, different bug** (route permission far weaker than what the page actually
needs, carried over from ES-34's research): `OpeningBalancesPage`'s route (`App.tsx` and
`lib/navigation.ts`) was gated on `ACCOUNT_VIEW` — a common, widely-held permission —
while every backend action on that page (view status, save any wizard step, lock) requires
`OPENING_BALANCE_LOCK`. Any `ACCOUNT_VIEW` holder could reach the whole wizard and would
403 on every single click. Both route definitions fixed to `OPENING_BALANCE_LOCK`.

**Missing frontend permission constants** (backend-only, never mirrored — same class as
`CUSTOMER_DELETE` in ES-35), added to `apps/web-frontend/src/constants/permissions.ts`:
`QUOTATION_CONVERT`, `PO_CANCEL`, `ITEM_DELETE`, `CATEGORY_CREATE`/`CATEGORY_UPDATE`/
`CATEGORY_DELETE`, `BRAND_CREATE`/`BRAND_UPDATE`, `UNIT_CREATE`/`UNIT_UPDATE`,
`SUPPLIER_DELETE`. The category/brand/unit gap was the most complete found in this whole
audit — only the `_VIEW` permission existed on the frontend for all three entity types;
every create/update/delete action was entirely invisible to the frontend permission system.

**Role-default completeness gap**, found alongside the `ITEM_EDIT` fix: `INVENTORY_MANAGER`
had `CATEGORY_CREATE`/`BRAND_CREATE` but no `_UPDATE`/`_DELETE` counterparts — a role whose
whole purpose is managing the item catalog could create categories/brands but never edit or
delete them. Added `CATEGORY_UPDATE`, `CATEGORY_DELETE`, `BRAND_UPDATE`, `UNIT_UPDATE` to
`INVENTORY_MANAGER`'s default set.

## Files Changed

| File | Change |
|------|--------|
| `apps/web-frontend/src/constants/permissions.ts` | 13 new constants |
| `apps/web-frontend/src/App.tsx` | 3 route-permission corrections (`ITEM_EDIT`, `SUPPLIER_EDIT`, `OPENING_BALANCE_LOCK`) |
| `apps/web-frontend/src/lib/navigation.ts` | 1 nav-permission correction (`OPENING_BALANCE_LOCK`) |
| `apps/tenant-service/src/rbac/role-defaults.ts` | `INVENTORY_MANAGER`, `PURCHASE_MANAGER` corrected/completed |
| 25 page files across `sales/`, `purchase/`, `accounting/`, `gst/`, `inventory/`, `items/`, `settings/`, `users/`, `suppliers/` | `canX` permission-gating pattern applied |
| `apps/web-frontend/src/pages/settings/__tests__/OrganizationPage.test.tsx` | Fixed — test rendered with no permissions, now-gated Save button disappeared; added `beforeEach` granting `ORG_SETTINGS_EDIT` |

## Test Results

`pnpm --filter @erp/web-frontend type-check` clean throughout (verified after every
directory batch, not just at the end). `pnpm --filter @erp/web-frontend test`: 17/17 pass
(6 test files — 1 fixed as above, `ItemsPage.test.tsx`/`SuppliersPage.test.tsx`/
`CustomersPage.test.tsx` continued passing unmodified since they don't assert on the newly
-gated buttons). `pnpm --filter @erp/tenant-service test`: 4/4 pass (2 skipped, pre-existing
DB-gated skips unrelated to this phase).

## Deployment Checklist

- [ ] **Backfill migration needed for existing tenants** (same caveat as ES-35's
      `CUSTOMER_EDIT` fix and every other `ROLE_DEFAULTS` change in this audit):
      `INVENTORY_MANAGER` (`ITEM_UPDATE`→`ITEM_EDIT`, +`CATEGORY_UPDATE`/
      `CATEGORY_DELETE`/`BRAND_UPDATE`/`UNIT_UPDATE`) and `PURCHASE_MANAGER`
      (`SUPPLIER_UPDATE`→`SUPPLIER_EDIT`) only take effect for newly-provisioned tenants.
      **Dev environment: no real tenants exist yet, so this is a no-op today** — write the
      equivalent backfill migration before any tenant relying on these roles reaches
      production. This is now the fourth such pending backfill from this audit
      (ES-35's `SALES_MANAGER` fix, plus these two) — worth doing as one consolidated
      migration rather than four separate ones.
- [x] No other DB migrations required — remaining changes are frontend permission
      constants + UI conditional-rendering only.

## Phases Unblocked

None — this is the final phase of the 5-phase RBAC audit (ES-33 through ES-37). See
`ERP-PLANNING/RBAC_ARCHITECTURE.md` for the consolidated writeup.
