# ES-37 — RBAC Audit Phase D: Frontend UI-Level Permission Gating
## STATUS: ✅ COMPLETED
## Sprint: Enterprise RBAC Refactor (Phase D of 5, final) | Effort: 2 days | Risk: Low
## Depends on: ES-33, ES-34, ES-35, ES-36
## Unlocks: none (final phase)

---

## YOUR ROLE

You are the **Principal Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP,
completing the 5-phase enterprise RBAC audit and refactor.

---

## OBJECTIVE

Close the biggest concrete gap the original research found: ~50 page files across Sales,
Purchase, Accounting, GST, Inventory, Settings, Users, Suppliers, Items rendered
create/edit/delete/approve/export buttons **unconditionally** — enforcement relied
entirely on the backend + route-level guard, so a user without permission saw the button,
clicked it, and got bounced to a 403/Access-Denied experience. Roll out the
`hasPermission()`-derived-boolean pattern already used correctly in `HR`, `Production`,
and `CustomerViewPage.tsx` to every remaining page.

---

## APPROACH

Went directory by directory, reading each page, and for every action button checked
**what permission the backend route actually enforces** (not guessed) before gating.
Skipped pages with no actions (pure reports) and pages where the backend enforces a single
permission for the entire feature including the route itself (per-button gating would be
redundant there, not missing).

---

## VERIFICATION CHECKLIST

- [x] Every create/edit/delete/approve/reject/dispatch/export/file/pay/cancel action
      across `sales/`, `purchase/`, `accounting/`, `gst/`, `inventory/`, `items/`,
      `settings/`, `users/`, `suppliers/` gated against the permission the backend route
      actually enforces (verified per-button, not assumed)
- [x] Frontend/backend permission-constant sync gaps found while gating (same class as
      ES-35's `CUSTOMER_DELETE`) fixed: `QUOTATION_CONVERT`, `PO_CANCEL`, `ITEM_DELETE`,
      full `CATEGORY_*`/`BRAND_*`/`UNIT_*` CRUD sets, `SUPPLIER_DELETE`
- [x] "Two similarly-named permissions, wrong one wired" bugs (ES-35's `CUSTOMER_UPDATE`/
      `CUSTOMER_EDIT` pattern) found and fixed 3 more times: `ITEM_UPDATE`/`ITEM_EDIT`,
      `SUPPLIER_UPDATE`/`SUPPLIER_EDIT`, `ORGANIZATION_SETTINGS_VIEW`/`ORG_SETTINGS_EDIT`
- [x] `OpeningBalancesPage` route-permission mismatch found and fixed (route was
      `ACCOUNT_VIEW`; every backend action requires `OPENING_BALANCE_LOCK`)
- [x] `pnpm --filter @erp/web-frontend type-check` clean
- [x] `pnpm --filter @erp/web-frontend test` — 17/17 pass, including a fix to
      `OrganizationPage.test.tsx` broken by the new gating
- [x] `pnpm --filter @erp/tenant-service test` — 4/4 pass after `role-defaults.ts` changes
- [x] Completion report saved at `ERP-PLANNING/phase-completions/ES-37_COMPLETION.md`
- [x] Consolidated `ERP-PLANNING/RBAC_ARCHITECTURE.md` written covering all 5 phases
