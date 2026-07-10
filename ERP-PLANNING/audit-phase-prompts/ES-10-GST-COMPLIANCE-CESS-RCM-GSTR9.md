# ES-10 — GST Compliance: Cess, RCM & GSTR-9
## STATUS: ✅ COMPLETED (adapted — see ES-10_COMPLETION.md for architecture deviations)
## Sprint: 3 | Effort: 5–6 days | Risk: High
## Depends on: ES-08 (sales), ES-09 (purchase)
## Unlocks: ES-11, ES-17

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: implement GST Cess calculations, Reverse Charge Mechanism (RCM) for applicable purchases, and the GSTR-9 annual return data extraction. Cloth/textile retail in India has specific GST rules you must follow.

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-09_COMPLETION.md`
- [ ] Read `apps/gst-service/src/domain/GSTEngine.ts` (or wherever GST logic lives) — full file
- [ ] Read `packages/db-client/src/schema/gst.ts` — all GST table definitions
- [ ] Read `apps/gst-service/src/api/gst.routes.ts`
- [ ] Read `apps/web-frontend/src/pages/gst/` — list existing pages
- [ ] Read `apps/web-frontend/src/pages/gst/EInvoicePage.tsx` — note the STUB banner from ES-01
- [ ] Read `packages/shared-types/src/gst.ts` (or search for GST type definitions)
- [ ] Check existing GSTR-1 and GSTR-3B data extraction if implemented
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-01 ✅ | Security | EInvoicePage has STUB banner; rate limit wired |
| ES-08 ✅ | Sales | Invoice confirmation, partial payments, cancellation |
| ES-09 ✅ | Purchase | Vendor invoice 3-way match, GRNI accrual |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | PostgreSQL 16 + Drizzle ORM | React 18 + Vite 5 + Tailwind v4 | Vitest

### Multi-Tenant Rules
- Every Drizzle query: `.where(eq(table.tenantId, ctx.tenantId))`
- Tenant ID: ALWAYS from `request.auth.tenantId`

### Money Rules
- ALL amounts in paise (integers)
- GST calculation: `Math.round(baseAmount * gstRate / 100)`
- Cess: `Math.round(baseAmount * cessRate / 100)` where cessRate can be % or per unit amount
- Round-off: max ±0.49 paise total across all tax lines

### India GST Domain Rules
```
CGST + SGST for intra-state B2B and B2C
IGST for inter-state
CGST rate = SGST rate = 50% of GST rate (e.g., 18% GST → 9% CGST + 9% SGST)

Cloth / Textile GST rates (as of 2024):
- Cotton fabrics: 5%
- Man-made fibres: 12%
- Silk, wool: 5%
- Readymade garments (MRP ≤ ₹999): 5%
- Readymade garments (MRP > ₹999): 12%

GST Cess:
- Cess applies to specific luxury / sin goods — check if relevant for this ERP
- Pan Masala, tobacco: specific cess rates (likely not relevant for cloth retail)
- If cess is required: cess_rate column must exist in items/HSN code table

RCM (Reverse Charge Mechanism):
- Applies when purchasing from unregistered vendors
- Buyer pays GST directly to government (not to supplier)
- Input Tax Credit available on RCM purchases
- Vendors marked as `is_unregistered = true` in vendors table trigger RCM

GSTR-9 (Annual Return):
- Summary of all GSTR-1 (outward supplies) and GSTR-3B (monthly returns) for a financial year
- Table 4: Taxable outward supplies
- Table 5: Outward supplies exempted/nil-rated
- Table 6: ITC availed
- Table 7: ITC reversed
- Table 9: Tax paid
- Due date: December 31 of following FY (e.g., FY 2025-26 → due Dec 31, 2026)
```

### Auth Pattern
```typescript
fastify.get('/gst/gstr9/:year', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.GST_RETURN_VIEW)],
}, handler)
```

### Coding Standards
- TypeScript strict — no `any`
- No `console.log` — use `packages/logger`
- GST calculation functions must be pure (no DB calls) and unit testable
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Add GST Cess support to the tax calculation engine
2. Implement RCM detection and posting for unregistered vendor purchases
3. Build GSTR-9 data extraction and export
4. Fix any GST calculation bugs found during implementation

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Fix 1 — GST Cess**

`packages/shared-types/src/gst.ts` (or equivalent):
Add `cessRate?: number` to the HSN/tax configuration type.

`apps/gst-service/src/domain/GSTEngine.ts`:
- In the tax calculation function, after computing CGST/SGST/IGST, add cess calculation:
  ```typescript
  const cess = cessRate ? Math.round(taxableAmount * cessRate / 100) : 0;
  ```
- Include `cess` in the returned tax breakdown
- Include cess in the invoice line's `tax_amount` total

`packages/db-client/src/schema/gst.ts`:
- Ensure `hsn_codes` table has `cess_rate NUMERIC(6,2) DEFAULT 0` column
- Migration: `000X_es10_gst_cess.sql`

Invoice line response must include:
```json
{ "taxableAmount": 10000, "cgst": 900, "sgst": 900, "igst": 0, "cess": 0, "totalTax": 1800, "lineTotal": 11800 }
```

**Fix 2 — RCM (Reverse Charge Mechanism)**

`packages/db-client/src/schema/purchase.ts`:
- Verify `vendors` table has `is_registered boolean NOT NULL DEFAULT true` and `gstin VARCHAR(15)` columns
- If missing, add via migration

`apps/purchase-service/src/domain/VendorInvoiceService.ts`:
On `match()` or approval of vendor invoice:
- If `vendor.is_registered = false`:
  - Mark vendor invoice as `rcm_applicable = true`
  - DO NOT include GST in vendor invoice amount (vendor doesn't charge GST)
  - Instead, create a separate RCM liability entry: write `RCM_LIABILITY_POSTED` to outbox
  - Accounting-service consumer: post DR RCM Tax Input / CR RCM Tax Payable

`apps/gst-service/src/domain/GSTEngine.ts`:
- Add `calculateRCMTax(baseAmount, gstRate, supplyType)` function
- RCM input tax credit: available only after payment is made to the vendor

Route: `GET /api/v1/gst/rcm-register` — list of all RCM transactions for a period
Guard: `requirePermission(PERMISSIONS.GST_RETURN_VIEW)`

**Fix 3 — GSTR-9 Annual Return**

`apps/gst-service/src/domain/GSTR9Engine.ts` (new file):

```typescript
export class GSTR9Engine {
  async generateGSTR9(tenantId: string, financialYear: string): Promise<GSTR9Data> {
    // Table 4: Taxable outward supplies (B2B + B2C)
    // Table 5: Nil-rated/exempt/non-GST
    // Table 6: ITC availed by type (IGST/CGST/SGST/CESS)
    // Table 7: ITC reversed (for credits notes/cancellations)
    // Table 9: Tax paid (segregated by CGST/SGST/IGST/Cess)
    // All queries: WHERE tenant_id = tenantId AND invoice_date BETWEEN fy_start AND fy_end
  }
}
```

All raw SQL queries MUST include `WHERE tenant_id = ${tenantId}`.

Route: `GET /api/v1/gst/gstr9?year=2025-26` → returns JSON with all GSTR-9 tables
Route: `GET /api/v1/gst/gstr9/export?year=2025-26&format=json` → downloadable JSON (GST portal format)

Frontend: `apps/web-frontend/src/pages/gst/GSTR9Page.tsx`
- Year selector (FY picker)
- Summary view: Table 4, Table 5, Table 6, Table 7, Table 9 as cards
- "Download JSON" button → triggers export endpoint
- "Prepare Filing" status indicator (shows if any gaps exist between GSTR-1 and GSTR-3B data)

**Fix 4 — GST calculation correctness audit**

For each invoice in the system:
- Verify: `cgst + sgst = igst = Math.round(taxableAmount * gstRate / 100)` (no floating point)
- Verify: intra-state → CGST + SGST set; IGST = 0
- Verify: inter-state → IGST set; CGST = SGST = 0
- Verify: composite supply → single GST rate on principal supply

If bugs found: fix in `GSTEngine.ts` and document in completion report.

### OUT OF SCOPE
- E-Invoice IRP integration (ES-11)
- E-Way Bill generation (ES-11)
- GSTR-1, GSTR-3B filing (separate — these are assumed already implemented or out of scope)
- GST reconciliation with GSTN portal (requires GSTN API integration)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/gst-service/src/__tests__/gst-engine.test.ts`:
1. Intra-state 18% GST on ₹10,000 → CGST ₹900 + SGST ₹900 + IGST ₹0 + Cess ₹0
2. Inter-state 18% GST on ₹10,000 → CGST ₹0 + SGST ₹0 + IGST ₹1,800
3. Intra-state with 3% cess → Cess = Math.round(10000 × 3 / 100) = 300
4. RCM: unregistered vendor invoice → rcm_applicable = true, no GST in vendor amount
5. GSTR-9 table 4: count of taxable outward supplies matches confirmed invoices
6. GSTR-9 table 6: ITC sum matches confirmed vendor invoices
7. Tenant isolation: GSTR-9 for tenant A returns zero tenant B data

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/gst-service build
pnpm --filter @erp/gst-service type-check
pnpm --filter @erp/purchase-service build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/gst-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Intra-state invoice → CGST + SGST present; IGST = 0
- [ ] Inter-state invoice → IGST present; CGST = SGST = 0
- [ ] Cess field present in invoice line response
- [ ] Unregistered vendor invoice → marked `rcm_applicable = true`
- [ ] `GET /gst/gstr9?year=2025-26` returns non-empty response with all 5 tables
- [ ] Export endpoint returns JSON file download
- [ ] `GSTR9Page.tsx` renders without errors
- [ ] Tenant isolation: tenant A GSTR-9 has zero tenant B invoices
- [ ] All 7 GST tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Existing invoice creation still calculates correct GST
- [ ] EInvoicePage still shows STUB banner (ES-01 — keep until ES-11)
- [ ] Existing GSTR-1 / GSTR-3B pages (if present) still load

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] GST Cess calculation working
- [ ] RCM detection and posting working
- [ ] GSTR-9 data extraction accurate
- [ ] 7 GST tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-10_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-10_COMPLETION.md`

```markdown
# ES-10 Completion Report — GST Compliance
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## GST Calculation Audit
- Bugs found: [N]
- Bugs fixed: [describe each]

## Cess Implementation
- Cess columns added to: [tables]

## RCM Implementation
- Unregistered vendor detection: [implemented]
- RCM accounting consumer: [implemented]

## GSTR-9
- Tables implemented: Table 4, Table 5, Table 6, Table 7, Table 9
- Data accuracy verified: [YES/NO + details]

## Files Changed
[Table]

## Tests: 7/7 PASS | lint: PASS | build: PASS

## Phases Unblocked
ES-11 (E-Invoice needs correct GST amounts)
ES-17 (analytics needs GST data)
```
