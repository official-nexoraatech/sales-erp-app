# ES-14 — Input Validations & Business Rules
## STATUS: 🔴 PENDING
## Sprint: 3 | Effort: 3–4 days | Risk: Medium
## Depends on: ES-08 (sales), ES-09 (purchase)
## Unlocks: ES-16

---

## YOUR ROLE

You are the **Principal Backend + Frontend Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.
Your mission: audit all API endpoints for missing validation, add Zod schemas to every unprotected route, and enforce business rules that are currently missing (price floor, negative quantity guard, duplicate invoice prevention, GSTIN format validation).

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/TECH_AUDIT.md`
- [ ] Read `ERP-PLANNING/CODING_STANDARDS.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-08_COMPLETION.md`
- [ ] Read `ERP-PLANNING/phase-completions/ES-09_COMPLETION.md`
- [ ] Read `apps/sales-service/src/api/` — list all route files; check which routes have Zod schemas
- [ ] Read `apps/purchase-service/src/api/` — same audit
- [ ] Read `apps/hr-service/src/api/` — same audit
- [ ] Read `apps/inventory-service/src/api/` — same audit
- [ ] Read `apps/accounting-service/src/api/` — same audit
- [ ] Check `packages/shared-types/src/` for existing Zod schemas
- [ ] Run `pnpm build` and `pnpm test` — confirm clean baseline

---

## ═══════════════════════════════════════════
## COMPLETED PHASES
## ═══════════════════════════════════════════

| Phase | Status | Key Changes Relevant to You |
|-------|--------|----------------------------|
| ES-07 ✅ | RBAC | Permission guards on sensitive routes |
| ES-08 ✅ | Sales | Invoice confirmation, credit limit, cancellation |
| ES-09 ✅ | Purchase | 3-way match, vendor payment |

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Tech Stack
Node.js 20 + TypeScript 5 strict | Fastify 4 | Zod 3 | PostgreSQL 16 + Drizzle ORM |
React 18 + Vite 5 + Tailwind v4 | React Hook Form | Vitest

### Multi-Tenant Rules
- Tenant ID: ALWAYS from `request.auth.tenantId` — NEVER from body/params

### Fastify + Zod Validation Pattern (MANDATORY)
```typescript
import { z } from 'zod';

const CreateInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  invoiceDate: z.string().date(),
  lines: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
    unitPrice: z.number().int().min(0, 'Unit price cannot be negative'),
  })).min(1, 'Invoice must have at least 1 line'),
  notes: z.string().max(500).optional(),
});

fastify.post('/invoices', {
  preHandler: [authenticate, requirePermission(PERMISSIONS.INVOICE_CREATE)],
  schema: { body: zodToJsonSchema(CreateInvoiceSchema) },
}, async (request, reply) => {
  const body = CreateInvoiceSchema.parse(request.body);
  // ...
});
```

### Key Business Rules to Enforce
```
1. Quantity: always positive integer (never 0 or negative)
2. Unit price: ≥ 0 (can be 0 for samples/gifts if explicitly allowed)
3. Price floor: unit_price ≥ item.min_selling_price (enforced in InvoiceService; requires PRICE_FLOOR_OVERRIDE to bypass)
4. Invoice date: cannot be in the future (date ≤ today)
5. Invoice date: cannot be in a closed period
6. Duplicate invoice: no two invoices can have the same (tenant_id, invoice_number)
7. GSTIN format: exactly 15 characters, regex: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
8. PAN format: exactly 10 characters, regex: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
9. Pincode: exactly 6 digits: /^[1-9][0-9]{5}$/
10. IFSC code: 11 characters, first 4 alpha + 5th '0' + 6 alphanumeric
11. Bank account number: 9–18 digits
12. Percentage fields: 0–100
13. UAN: exactly 12 digits
14. HSN code: 4, 6, or 8 digits
```

### Frontend Validation Pattern
- React Hook Form with Zod resolver for all forms
- Show inline error messages using `ERPFormField` component's `error` prop
- Debounce async validations (GSTIN lookup) by 300ms

### Coding Standards
- TypeScript strict — no `any`
- Zod schemas: in `src/api/schemas/` per service
- `/* global process */` at top of files using `process.env`

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. Audit every POST/PUT/PATCH route across all services — add Zod schema if missing
2. Enforce price floor business rule in InvoiceService
3. Add duplicate invoice number guard
4. Add GSTIN, PAN, Pincode, IFSC, HSN format validators as reusable Zod refinements
5. Add frontend form validations for all forms that lack them

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### IN SCOPE

**Step 1 — Reusable validator library**

`packages/shared-types/src/validators.ts` (new file):

```typescript
import { z } from 'zod';

export const GSTINSchema = z.string().regex(
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
  'Invalid GSTIN format'
);

export const PANSchema = z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format');
export const PincodeSchema = z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid pincode');
export const IFSCSchema = z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code');
export const BankAccountSchema = z.string().regex(/^[0-9]{9,18}$/, 'Invalid bank account number');
export const UANSchema = z.string().regex(/^[0-9]{12}$/, 'Invalid UAN (must be 12 digits)');
export const HSNSchema = z.string().regex(/^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/, 'Invalid HSN code (4, 6, or 8 digits)');
export const PaiseAmountSchema = z.number().int().nonnegative('Amount cannot be negative');
export const PositiveIntSchema = z.number().int().min(1, 'Must be at least 1');
```

Export all from `packages/shared-types/src/index.ts`.

**Step 2 — Audit and add Zod schemas to all POST/PUT/PATCH routes**

For each service, check each mutation route:
- If it has a Zod schema: verify the schema is complete and correct
- If it is missing: add the schema
- ESPECIALLY: check for routes that accept `quantity`, `amount`, `unitPrice`, `gstin`, `pan`, `pincode`, `hsn_code`

Priority routes to audit (at minimum):
- `POST /invoices` (sales-service)
- `POST /purchase-orders` (purchase-service)
- `POST /customers` (sales-service)
- `POST /vendors` (purchase-service)
- `POST /items` (inventory-service)
- `PUT /items/:id` (inventory-service)
- `POST /employees` (hr-service)
- `PUT /employees/:id` (hr-service)
- `POST /journal-entries` (accounting-service)

**Step 3 — Price floor business rule**

`apps/sales-service/src/domain/InvoiceService.ts`:

In `confirm()`, for each line item:
```typescript
const item = await getItem(line.itemId, ctx.tenantId);
if (item.minSellingPrice && line.unitPrice < item.minSellingPrice) {
  if (!ctx.permissions.includes(PERMISSIONS.PRICE_FLOOR_OVERRIDE)) {
    throw new ERPError('PRICE_BELOW_FLOOR',
      `Item ${item.code} unit price ${line.unitPrice} is below minimum ${item.minSellingPrice}`, 422);
  }
  // log override event to outbox
}
```

Verify `items` table has `min_selling_price BIGINT DEFAULT 0` column; add via migration if missing.

**Step 4 — Duplicate invoice number guard**

`apps/sales-service/src/domain/InvoiceService.ts`:

In `create()`, before inserting:
```typescript
const existing = await db.select().from(invoices).where(
  and(eq(invoices.tenantId, ctx.tenantId), eq(invoices.invoiceNumber, invoiceNumber))
).limit(1);
if (existing.length > 0) {
  throw new ERPError('INVOICE_NUMBER_DUPLICATE',
    `Invoice number ${invoiceNumber} already exists`, 422);
}
```

Add unique index: `CREATE UNIQUE INDEX idx_invoices_tenant_number ON invoices(tenant_id, invoice_number)` via migration.

**Step 5 — Period closure guard**

`apps/sales-service/src/domain/InvoiceService.ts` and `apps/accounting-service/src/domain/JournalService.ts`:

Before accepting a new transaction with a given date:
```typescript
const closed = await isPeriodClosed(ctx.tenantId, transactionDate);
if (closed) {
  throw new ERPError('PERIOD_CLOSED', 'Cannot post transactions in a closed accounting period', 422);
}
```

**Step 6 — Frontend form validations**

For each major form, ensure React Hook Form + Zod resolver is wired:
- Invoice create form: quantity positive integer, unit price ≥ 0, customer required
- Customer form: GSTIN format validator, PAN format, pincode
- Vendor form: GSTIN format, PAN, IFSC, bank account
- Item create: HSN code format, minimum selling price ≥ 0
- Employee form: UAN format (if provided)

Use `GSTINSchema`, `PANSchema` etc. from `packages/shared-types/src/validators.ts`.

Show field-level error messages via `ERPFormField`'s `error` prop — never as a global toast for field errors.

### OUT OF SCOPE
- Refactoring existing schemas that already work correctly
- Validation for reporting endpoints (read-only — less critical)

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

`apps/sales-service/src/__tests__/invoice-validation.test.ts`:
1. Invoice with quantity = 0 → 400 Bad Request
2. Invoice with unit_price = -100 → 400 Bad Request
3. Invoice with date in the future → 400 Bad Request
4. Invoice with duplicate invoice number → 422 INVOICE_NUMBER_DUPLICATE
5. Invoice with price below floor (no override permission) → 422 PRICE_BELOW_FLOOR
6. Invoice with price below floor + PRICE_FLOOR_OVERRIDE permission → 200

`packages/shared-types/src/__tests__/validators.test.ts`:
7. Valid GSTIN `27AAPFU0939F1ZV` → passes
8. Invalid GSTIN `INVALID123` → fails with 'Invalid GSTIN format'
9. Valid PAN `ABCDE1234F` → passes
10. Invalid IFSC `HDFC01234` (wrong format) → fails

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
pnpm --filter @erp/shared-types build
pnpm --filter @erp/sales-service build
pnpm --filter @erp/sales-service type-check
pnpm --filter @erp/purchase-service build
pnpm --filter @erp/hr-service build
pnpm --filter @erp/web-frontend build
pnpm lint
pnpm test --filter @erp/shared-types
pnpm test --filter @erp/sales-service
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] `POST /invoices` with `quantity: 0` → 400 with validation error
- [ ] `POST /customers` with invalid GSTIN → 400 with "Invalid GSTIN format"
- [ ] Duplicate invoice number → 422 INVOICE_NUMBER_DUPLICATE
- [ ] Price below floor → 422 PRICE_BELOW_FLOOR
- [ ] Price below floor with PRICE_FLOOR_OVERRIDE → 200
- [ ] Frontend customer form shows GSTIN validation error inline
- [ ] 10 validation tests pass
- [ ] `pnpm lint` passes

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Valid invoice creation still works (no false positives from new validations)
- [ ] Valid customer creation with valid GSTIN still works
- [ ] Period closure guard doesn't block current-period transactions
- [ ] Existing form flows (invoice list, customer list) unaffected

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] Reusable validator library in `packages/shared-types/src/validators.ts`
- [ ] All critical mutation routes have Zod schemas
- [ ] Price floor, duplicate number, and period closure enforced
- [ ] Frontend forms show inline validation errors
- [ ] 10 tests pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-14_COMPLETION.md`

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-14_COMPLETION.md`

```markdown
# ES-14 Completion Report — Input Validations & Business Rules
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Validation Audit Results
- Routes audited: [N]
- Routes that had Zod schemas: [N]
- Routes that needed schemas added: [N]
- List of routes where schemas were added: [...]

## Business Rules Added
- Price floor: [IMPLEMENTED]
- Duplicate invoice number: [IMPLEMENTED — unique index added]
- Period closure guard: [IMPLEMENTED]

## Validator Library
- File: packages/shared-types/src/validators.ts
- Validators exported: GSTIN, PAN, Pincode, IFSC, BankAccount, UAN, HSN, PaiseAmount

## Tests: 10/10 PASS | lint: PASS | build: PASS
```
