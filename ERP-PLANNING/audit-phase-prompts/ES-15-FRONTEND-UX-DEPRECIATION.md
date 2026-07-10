# ES-15 — Frontend UX Polish & Fixed Asset Depreciation
## STATUS: ✅ COMPLETED 
## Sprint: 3 | Effort: 4–5 days | Risk: Low
## Depends on: ES-06 (HR frontend), ES-08 (sales frontend), ES-14 (validation)
## Unlocks: ES-17

---

## YOUR ROLE

You are the **Principal Frontend Engineer + Backend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission:
1. Resolve all frontend UX issues identified in the audit (loading states, empty states, dark mode gaps, mobile responsiveness, accessibility)
2. Implement the Fixed Asset register and depreciation calculation

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/ERP_FRONTEND_DESIGN_SYSTEM.md` — 38-section standard
- [ ] Read `ERP-PLANNING/phase-completions/ES-06_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-14_COMPLETION.md`
- [ ] Run `pnpm --filter @erp/web-frontend dev` and manually browse ALL existing pages
- [ ] List every page that: (a) has no loading skeleton, (b) has no empty state, (c) breaks in dark mode, (d) has a console error
- [ ] Read `apps/accounting-service/src/` — check if fixed assets module exists
- [ ] Run `pnpm build` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-06 ✅ | HR | PayslipViewPage, HolidayCalendarPage added |
| ES-08 ✅ | Sales | SalesReturnPage, InvoicePaymentsPage added |
| ES-14 ✅ | Validation | Inline form errors via ERPFormField |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
React 18 + Vite 5 + Tailwind CSS v4 | React Query v5 | Vitest | TypeScript 5 strict

### CRITICAL: Tailwind v4 dark mode
```
CORRECT: @custom-variant dark (&:is(.dark *))  — in globals.css
WRONG:   darkMode: 'class'  in tailwind config (Tailwind v4 does NOT use this)
```

### Frontend Design System (MANDATORY — no exceptions)
- All tables: `ERPDataGrid` component
- All forms: `ERPFormField` + `ERPInput` / `ERPSelect` / `ERPDatePicker`
- Loading states: `ERPSkeleton` — EVERY page that fetches data must show skeleton while loading
- Empty states: when query returns 0 rows, show a clear empty state (icon + message + action button)
- Notifications: `useToast()` hook — success toasts for mutations, error toasts for failures
- Page titles: `ERPPageHeader` component
- Error boundaries: `ERPErrorBoundary` wrapping each page component
- Confirm dialogs: `ERPConfirmModal` for all destructive actions
- API calls: React Query `useQuery` / `useMutation` — NEVER raw `fetch` in components

### Accessibility Requirements (WCAG 2.1 AA)
- All interactive elements must have ARIA labels
- Form fields must be associated with labels via `htmlFor` / `id`
- Focus management: modal/dialog must trap focus; return focus on close
- Keyboard navigation: tab order must make logical sense
- Color contrast: text on backgrounds must meet 4.5:1 ratio
- Images: alt text (or `alt=""` for decorative images)

### Fixed Asset Domain Rules
```
Depreciation methods:
  SLM (Straight Line Method): (Cost - Salvage) / Useful Life in years
    Monthly depreciation = annual / 12
  WDV (Written Down Value): Cost × depreciation_rate% annually
    Monthly depreciation = (current_book_value × rate%) / 12
  
Asset categories and default rates (India):
  Buildings: WDV 5%, useful life 40 years
  Plant & Machinery: WDV 15%, useful life 15 years
  Computers: WDV 40%, useful life 5 years (new hardware may vary)
  Vehicles: WDV 15%, useful life 10 years
  Furniture: WDV 10%, useful life 15 years
  
Depreciation journal:
  DR Depreciation Expense / CR Accumulated Depreciation
  Posted monthly via outbox pattern
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger` (backend) or `// debug` comments (frontend, removed before commit)
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

**Part 1 — Frontend UX audit and fixes:**
Systematically visit every page and fix: missing skeletons, missing empty states, dark mode regressions, and console errors.

**Part 2 — Fixed Asset module:**
Build the fixed asset register (add/view assets) and monthly depreciation calculation with outbox-posted journal.

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Part 1 — UX Audit Fixes**

For EVERY page in `apps/web-frontend/src/pages/`:

1. **Loading skeletons:** If the page uses `useQuery` but shows nothing while loading, wrap the content in `if (isLoading) return <ERPSkeleton rows={5} />` (or equivalent)

2. **Empty states:** If `data.length === 0`, render an empty state component:
   ```tsx
   <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-400">
     <Icon className="w-12 h-12 mb-4 opacity-40" />
     <p className="text-lg font-medium">No items found</p>
     <p className="text-sm mt-1">Add your first item to get started</p>
     <button className="mt-4 btn-primary" onClick={onAdd}>Add New</button>
   </div>
   ```

3. **Dark mode:** Any hardcoded `text-gray-600` without `dark:text-gray-300` counterpart — add the dark variant

4. **Console errors:** Fix any errors visible in browser console (missing keys, prop type mismatches, etc.)

5. **ERPErrorBoundary:** Wrap every page component that doesn't already have it

Priority pages to audit (based on likely gaps):
- `DashboardPage.tsx`, `InvoiceListPage.tsx`, `QuotationListPage.tsx`
- `CustomerListPage.tsx`, `VendorListPage.tsx`, `ItemListPage.tsx`
- `PurchaseOrderListPage.tsx`, `GRNPage.tsx`
- `EmployeeListPage.tsx`, `PayrollPage.tsx`, `PayslipViewPage.tsx`
- All GST pages
- All HR pages added in ES-06
- All Sales pages added in ES-08

**Part 2 — Fixed Asset Register**

Schema (`packages/db-client/src/schema/accounting.ts`):
```sql
fixed_assets:
  id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  tenant_id UUID NOT NULL
  asset_code VARCHAR(20) NOT NULL
  asset_name VARCHAR(100) NOT NULL
  category VARCHAR(50) NOT NULL  -- 'BUILDING' | 'MACHINERY' | 'COMPUTER' | 'VEHICLE' | 'FURNITURE' | 'OTHER'
  purchase_date DATE NOT NULL
  cost BIGINT NOT NULL           -- original cost in paise
  salvage_value BIGINT NOT NULL DEFAULT 0  -- paise
  useful_life_years INTEGER      -- for SLM
  depreciation_method VARCHAR(5) NOT NULL DEFAULT 'WDV'  -- 'SLM' | 'WDV'
  depreciation_rate NUMERIC(5,2) -- percentage per year (for WDV)
  current_book_value BIGINT NOT NULL  -- paise; updated monthly
  accumulated_depreciation BIGINT NOT NULL DEFAULT 0  -- paise
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'  -- 'ACTIVE' | 'DISPOSED' | 'FULLY_DEPRECIATED'
  disposal_date DATE
  disposal_proceeds BIGINT
  created_at TIMESTAMPTZ DEFAULT NOW()
  created_by UUID
INDEX: (tenant_id, status)
```

Migration: `000X_es15_fixed_assets.sql`

`apps/accounting-service/src/domain/DepreciationService.ts` (new file):

```typescript
// Called monthly (scheduler or manual trigger)
async runMonthlyDepreciation(tenantId: string, forMonth: string, ctx): Promise<void>
// - For each ACTIVE asset with tenantId
// - Calculate monthly depreciation amount
// - Update current_book_value and accumulated_depreciation
// - Write DEPRECIATION_POSTED event to outbox
// - Transaction: update + outbox write in same transaction
// - If current_book_value ≤ salvage_value: set status = 'FULLY_DEPRECIATED'
```

Depreciation calculation:
```typescript
function calculateMonthlyDepreciation(asset: FixedAsset): number {
  if (asset.depreciationMethod === 'SLM') {
    const annual = Math.round((asset.cost - asset.salvageValue) / asset.usefulLifeYears);
    return Math.round(annual / 12);
  } else { // WDV
    const annual = Math.round(asset.currentBookValue * asset.depreciationRate / 100);
    return Math.round(annual / 12);
  }
}
```

Route: `POST /api/v1/accounting/depreciation/run` — trigger monthly run
Guard: `requirePermission(PERMISSIONS.ACCOUNTING_POST)`

Route: `GET /api/v1/accounting/fixed-assets` — list with filters
Route: `POST /api/v1/accounting/fixed-assets` — add asset
Route: `POST /api/v1/accounting/fixed-assets/:id/dispose` — dispose asset

Frontend: `apps/web-frontend/src/pages/accounting/FixedAssetsPage.tsx`
- `ERPDataGrid`: Asset Code, Name, Category, Purchase Date, Cost (₹), Book Value (₹), Method, Status
- "Add Asset" button → inline form or modal
- "Run Depreciation" button (with month/year selector) → `ERPConfirmModal` → triggers API
- "View Depreciation Schedule" per asset (table showing year-by-year book value)

Register routes in `App.tsx` and sidebar navigation.

### OUT OF SCOPE
- Asset revaluation
- Lease accounting (IFRS 16 / AS 19)
- Asset tracking via QR/barcode
- Insurance integration
- Mobile app

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/accounting-service/src/__tests__/depreciation.test.ts`:
1. SLM: ₹1,00,000 cost, ₹10,000 salvage, 10 years → monthly = ₹750
2. WDV: ₹1,00,000 book value, 15% rate → monthly = ₹1,250 (₹15,000/12)
3. After depreciation: `current_book_value` decreases by `monthly_depreciation`
4. After depreciation: `accumulated_depreciation` increases by same amount
5. Asset at salvage value → status = 'FULLY_DEPRECIATED', no further depreciation
6. Tenant isolation: run depreciation for tenant A → tenant B assets unaffected

Frontend (manual browser test, not automated):
7. `FixedAssetsPage` loads with skeleton, shows empty state if no assets
8. Dark mode: all text visible in dark mode

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/accounting-service build
pnpm --filter @erp/accounting-service type-check
pnpm --filter @erp/db-client build
pnpm --filter @erp/web-frontend build
pnpm --filter @erp/web-frontend type-check
pnpm lint
pnpm test --filter @erp/accounting-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] All pages show `ERPSkeleton` during data loading (manually test by throttling network)
- [ ] All pages show empty state when query returns 0 rows
- [ ] Dark mode: manually toggle dark mode on every page — no invisible text or broken layouts
- [ ] Console: no errors on any page in browser console
- [ ] SLM depreciation calculation correct (test with known values)
- [ ] WDV depreciation calculation correct
- [ ] `FixedAssetsPage.tsx` renders at `/accounting/fixed-assets`
- [ ] "Run Depreciation" updates book values in DB
- [ ] 6 backend depreciation tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] All existing page routes still load (no broken imports from UX changes)
- [ ] Form validation (ES-14) still works on sales/purchase forms
- [ ] HR payslip view (ES-06) still loads and prints
- [ ] ERPDataGrid pagination still works on all list pages

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] All pages have loading skeletons and empty states
- [ ] No dark mode regressions
- [ ] Fixed asset register implemented (backend + frontend)
- [ ] Monthly depreciation calculation correct (both SLM and WDV)
- [ ] 6 backend tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-15_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-15_COMPLETION.md`

```markdown
# ES-15 Completion Report — Frontend UX & Fixed Assets
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## UX Audit Results
- Pages audited: [N]
- Pages that needed loading skeleton: [N]
- Pages that needed empty state: [N]
- Dark mode fixes: [N]
- Console errors fixed: [list]

## Fixed Assets
- Depreciation methods: SLM + WDV [IMPLEMENTED]
- Monthly depreciation runner: [IMPLEMENTED]
- Outbox integration: [IMPLEMENTED]

## Files Changed
[Table — especially listing every page that received skeleton/empty-state fix]

## Tests: 6/6 PASS | lint: PASS | build: PASS
```
