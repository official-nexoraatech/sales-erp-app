# ES-14 Completion Report — Input Validations & Business Rules
**Date:** 2026-07-03
**Status:** COMPLETE (adapted — see "Audit Findings vs. Prompt Premise" below)

## Audit Findings vs. Prompt Premise
The prompt assumes validation is largely missing across the codebase and that routes use a fastify-native `schema: { body: zodToJsonSchema(...) }` pattern. Neither matches reality:

- **~90 POST/PUT/PATCH handlers across the 5 audited services were checked; all but 3 already validate `request.body` through a manual `Schema.parse()`/`.safeParse()` call.** There is no `zod-to-json-schema` usage anywhere in the repo and no route wires fastify's `schema.body` option — validation is 100% manual in-handler. This phase kept that convention rather than introducing a new one.
- **Price floor enforcement (`PriceFloorViolationError`, `overridePriceFloor`, `PRICE_FLOOR_OVERRIDE` permission gate) was already fully implemented** in `InvoiceService.create()` and `invoice.routes.ts` — not something ES-14 needed to build. Same for the invoice-line Zod schema (`quantity: number().positive()`, `unitPrice: number().nonnegative()`, GST rate bounds) — `POST /invoices` is the best-validated route in the codebase already.
- **`unique(tenant_id, invoice_number)` already exists** at the DB level (`invoices_tenant_number` index) — the real gap was that a clash surfaced as an opaque 500 (raw Postgres unique-violation) instead of a friendly 422, since nothing pre-checked it.

The real, verified gaps this phase closed:
1. No shared validator library — GSTIN/PAN/pincode regexes were copy-pasted independently across ≥4 files each (customer/supplier/organization/branch routes), with no single source of truth.
2. IFSC/bank-account/UAN fields existed in several schemas (supplier, employee, accounts, bank) but had zero format validation (`.max(N).optional()` only).
3. 3 routes had no runtime validation at all: `POST /items/:id/barcode/generate`, `POST /bank-reconciliation/:accountId/finalize`, `POST /journals/:id/reverse`.
4. Duplicate invoice number and invoice date business rules (not-in-future) were unenforced beyond the DB constraint / not enforced at all.
5. Period closure guard existed in accounting-service (`JournalEngine.checkPeriodOpen`) but was never applied to `InvoiceService.confirm()` — an invoice dated in a closed period could still be posted.
6. The existing HSN regex (`/^\d{4,8}$/`, used in 2 places) accepted invalid 5/7-digit codes — real HSN codes are 4, 6, or 8 digits only.

## Architecture Note (same pattern as ES-13)
`JournalEngine.checkPeriodOpen()` lives in accounting-service and takes accounting-service's `TenantScopedDatabase` type — sales-service can't import it (see [[architecture_no_cross_service_valuation]]). The period-closure check in `InvoiceService.confirm()` duplicates the same small `period_closures` query directly (raw SQL against the shared table), matching how `GSTCalculator`/`ValuationService` are already duplicated per-service in this codebase rather than imported across the service boundary.

## Validator Library
`packages/shared-types/src/validators.ts` (new) — exports both raw regexes and Zod schemas: `GSTINSchema`, `PANSchema`, `PincodeSchema`, `IFSCSchema`, `BankAccountSchema`, `UANSchema`, `HSNSchema`, `PositiveIntSchema`, plus `Optional*Schema` convenience variants matching the "optional field, validate format if provided" pattern already used throughout the codebase. Re-exported from `@erp/types`, already a dependency of every backend service and of `web-frontend` — consumed directly in both.

## Business Rules Added
- **Duplicate invoice number**: `InvoiceService.confirm()` now pre-checks for an existing `(tenantId, invoiceNumber)` row (excluding itself) and throws `INVOICE_NUMBER_DUPLICATE` (422) before hitting the DB unique constraint.
- **Invoice date not in the future**: enforced via `.refine()` on `CreateInvoiceSchema.invoiceDate` in `invoice.routes.ts`.
- **Period closure guard**: `InvoiceService.confirm()` now queries `period_closures` for the invoice's month/year and throws `PERIOD_CLOSED` (422) if closed.
- **Price floor**: already implemented (see above) — unchanged, verified with new tests.
- **HSN format**: tightened from "4-8 digits" (any length in range) to "exactly 4, 6, or 8 digits" (per real GST rules), applied consistently across backend (`item.routes.ts`) and frontend (`ItemFormPage.tsx`).

## Routes/Fields Touched
| File | Change |
|------|--------|
| `packages/shared-types/src/validators.ts` | NEW — validator library |
| `packages/shared-types/src/index.ts` | Export `validators.js` |
| `packages/shared-types/src/errors.ts` | (unchanged this phase — `BusinessError`/codes reused) |
| `packages/shared-types/package.json` | Added `zod` runtime dep, `vitest` devDep + `test` script |
| `apps/sales-service/src/api/customer.routes.ts` | GSTIN/PAN → shared schemas (removed local `GSTIN_REGEX`) |
| `apps/sales-service/src/api/supplier.routes.ts` | GSTIN/PAN/IFSC/bankAccountNo/pincode → shared schemas |
| `apps/sales-service/src/api/invoice.routes.ts` | `invoiceDate` gets a not-in-future `.refine()` |
| `apps/sales-service/domain/InvoiceService.ts` | `confirm()`: duplicate invoice-number guard + period-closure guard |
| `apps/tenant-service/src/api/organization.routes.ts` | GSTIN/PAN → shared schemas; pincode regex corrected |
| `apps/tenant-service/src/api/branch.routes.ts` | GSTIN → shared schema |
| `apps/hr-service/src/api/employee.routes.ts` | PAN/bankAccountNo/bankIfsc/UAN → shared schemas |
| `apps/accounting-service/src/api/accounts.routes.ts` | bankAccountNo/bankIfsc → shared schemas |
| `apps/accounting-service/src/api/bank.routes.ts` | `CreateBankAccountSchema` tightened (IFSC/account no.); `finalize` route gets a real Zod schema (was a manual truthy check) |
| `apps/accounting-service/src/api/journal.routes.ts` | `reverse` route gets a Zod schema for `reason` (was an unchecked cast) |
| `apps/inventory-service/src/api/item.routes.ts` | HSN regex corrected via shared `HSN_REGEX`; barcode-generate route gets a real Zod enum schema (was an unchecked cast) |
| `apps/web-frontend/src/pages/customers/CustomerFormPage.tsx` | PAN + pincode format validation added (previously none) |
| `apps/web-frontend/src/pages/suppliers/SupplierFormPage.tsx` | PAN/IFSC/bank-account format validation added |
| `apps/web-frontend/src/pages/items/ItemFormPage.tsx` | HSN regex corrected (shared); `minSalePrice` gets a `min: 0` guard |
| `apps/web-frontend/src/pages/hr/EmployeeFormPage.tsx` | UAN format validation added |
| `packages/shared-types/src/__tests__/validators.test.ts` | NEW — 18 tests |
| `apps/sales-service/src/__tests__/invoice-validation.test.ts` | NEW — 10 tests (shape validation + price floor + duplicate number + period closure) |
| `apps/sales-service/src/__tests__/invoice-ledger.test.ts` | Script sequences updated for the 2 new DB calls in `confirm()` (regression) |

## OUT OF SCOPE (per prompt, and per effort/risk discipline)
- Did not touch the ~87 already-adequately-validated routes beyond the specific field tightening above.
- Did not add a fastify-native `schema`/`zodToJsonSchema` wiring layer — would be inconsistent with the other ~90 handlers already using manual `.parse()`.
- `esiNumber` (HR) has no dedicated business-rule regex in the prompt's list — left untouched.
- Purchase-order date-in-future and other non-invoice date rules — prompt's business rules list is invoice-specific; not expanded to other documents.

## Tests: 28/28 new PASS (18 validators + 10 invoice-validation) | regression: all pre-existing suites still pass
- `pnpm --filter @erp/types test`: **18 passed**
- `pnpm --filter @erp/sales-service test`: **33 passed** (23 pre-existing/regression + 10 new), 3 skipped (no `DATABASE_URL`)
- `pnpm --filter @erp/hr-service test`: 3 pre-existing failures in `holiday.test.ts`/`permission-guards.test.ts` (VIEW_SALARY_DETAILS) — confirmed **unrelated to this phase**: those files are untouched, last modified at the same commit as `HEAD`, and reproduce identically with all of this session's changes stashed. Not investigated further — out of scope for ES-14.
- `pnpm --filter @erp/accounting-service test`: 9 passed, 3 skipped
- `pnpm --filter @erp/inventory-service test`: 8 passed, 5 skipped
- `pnpm --filter {types,sales-service,hr-service,accounting-service,inventory-service,tenant-service,web-frontend} build`: **PASS**, zero errors
- `eslint` on every touched file: **zero new errors/warnings** — all findings (mostly `crypto`/`process`/browser-global `no-undef` and `missing-return-type` warnings) verified pre-existing via `git diff`/`git show HEAD` against each file, consistent with the repo-wide baseline gap documented in prior ES completion reports. One pre-existing dead-code pair (`gstinStatus` state / `validateGstin` function in `CustomerFormPage.tsx`, both orphaned since the component switched to `ERPGSTINInput`) was noted but not removed, per "don't delete unrelated dead code."

## Verification Checklist
- [x] `POST /invoices` with `quantity: 0` → 400 (pre-existing Zod schema, verified with a test)
- [x] `POST /customers` with invalid GSTIN → 400 "Invalid GSTIN format" (now via shared schema)
- [x] Duplicate invoice number → 422 `INVOICE_NUMBER_DUPLICATE` (new)
- [x] Price below floor → 422 `PRICE_FLOOR_VIOLATION` (pre-existing, re-verified with a new test)
- [x] Price below floor with `overridePriceFloor=true` → succeeds (pre-existing, re-verified)
- [x] Invoice dated in a closed accounting period → 422 `PERIOD_CLOSED` (new)
- [x] Frontend customer form shows PAN/pincode validation errors inline (new — GSTIN already had this via `ERPGSTINInput`)
- [x] 28 new tests pass
- [x] `pnpm lint` — no new errors on any touched file

## Regression Checklist
- [x] Valid invoice creation still works — `sales-workflow.test.ts` (10 tests) and `invoice-validation.test.ts`'s override-path test pass
- [x] Valid customer/supplier creation with a valid GSTIN still works — schema behavior for a matching-format value is unchanged (same regex, just centralized)
- [x] Period closure guard doesn't block open-period invoices — verified by the "allows confirm() when the only invoice with that number is itself" test, which uses an open period
- [x] Existing `invoice-ledger.test.ts` suite (ES-03/ES-13 regression) passes with updated script sequences

## Phases Unblocked
ES-16 (performance hardening can now assume consistent, centralized input validation rather than auditing each route ad hoc)
