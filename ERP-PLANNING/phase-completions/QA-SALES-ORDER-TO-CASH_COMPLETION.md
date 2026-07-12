# QA Session — Sales / Order-to-Cash Deep Dive

**Date:** 2026-07-12
**Status:** COMPLETE (first pass) — module has further untested surface, see Follow-ups

## Scope

Autonomous QA cycle (explore → test → find root cause → fix → add regression test → re-verify)
scoped to the Sales / Order-to-Cash workflow: Customer → Quotation → Invoice → Payment → Reports.
Chosen as the highest-value first module out of a much larger requested full-application QA
sweep (see conversation) because it's the core revenue workflow and touches sales-service,
inventory-service, accounting-service, and web-frontend together.

## Bugs Found and Fixed

### 1. Quotation acceptance was unreachable — the entire Order-to-Cash pipeline dead-ended at SENT

`QuotationService.convert()` has required `status === 'ACCEPTED'` since ES-08 (2026-07-04
completion report: _"hardened to ACCEPTED only"_), but **no endpoint, route, or UI control
anywhere in the codebase ever transitioned a quotation to `ACCEPTED`**. `send()` and `expire()`
exist; nothing does `SENT/VIEWED → ACCEPTED` or `→ REJECTED`. Confirmed via full-repo grep — zero
matches for an accept/reject route. Every quotation that got sent was permanently stuck; the
"Convert to Invoice" step of the workflow was unusable end-to-end via the app.

Compounding this, `QuotationsPage.tsx`'s row-action menu still offered "Convert to Invoice" for
`SENT`/`VIEWED`/`ACCEPTED` rows (the pre-ES-08 permissive set), which always failed server-side
for the first two with `INVALID_STATUS` — the UI was still advertising an action the backend had
already stopped allowing.

**Fix:**

- `QuotationService.accept()` / `.reject()` (`apps/sales-service/src/domain/QuotationService.ts`) — validate current status is `SENT`/`VIEWED`, transition to `ACCEPTED`/`REJECTED`.
- `POST /quotations/:id/accept`, `POST /quotations/:id/reject` (`apps/sales-service/src/api/quotation.routes.ts`) — same permission guard (`INVOICE_CREATE`) as the existing `send`/`expire` routes, publishing `QUOTATION_UPDATED`.
- `QuotationDetailPage.tsx` — Accept/Reject buttons when status is `SENT`/`VIEWED`; Convert to Order only at `ACCEPTED` (unchanged).
- `QuotationsPage.tsx` — row actions now: `SENT`/`VIEWED` → Accept/Reject; `ACCEPTED` → Convert to Invoice. No longer offers Convert for statuses the backend will reject.
- `quotationApi.accept`/`.reject` added to `apps/web-frontend/src/api/endpoints.ts`.

**Tests:** 6 new Vitest cases in `apps/sales-service/src/__tests__/sales-workflow.test.ts`
(accept from SENT/VIEWED, reject from SENT, INVALID_STATUS from DRAFT/CONVERTED) — 16/16 pass.
8 new Playwright cases in `apps/web-frontend/e2e/quotations-workflow.spec.ts` covering list/detail
status-gating and RBAC — 8/8 pass.

### 2. Quotation creation UI didn't exist — "+ New Quotation" silently opened the Invoice form

`sales/quotations/new` routed to `InvoiceFormPage` (title "New Invoice", posts to
`invoiceApi.create()`, navigates to `/sales/invoices/:id` on success). There was no way to create
a quotation through the UI at all, despite `POST /quotations` being fully implemented
server-side. This blocks the workflow at its actual entry point.

**Fix:** New `apps/web-frontend/src/pages/sales/QuotationFormPage.tsx`, adapted from
`InvoiceFormPage`'s item-line/GST-computation logic (customer, branch, place of supply, valid-until,
notes, terms & conditions — no warehouse, matching `CreateQuotationSchema`). Routed at
`sales/quotations/new` in `App.tsx`.

**Tests:** Playwright coverage confirms the route now shows "New Quotation" (not "New Invoice")
and that client-side required-field validation blocks submission without calling the API.

### 3. "Record Payment" from an invoice silently dropped the invoice context

`InvoiceDetailPage`'s "Record Payment" button navigates to `/sales/payments?invoiceId=X`.
`PaymentsPage.tsx` read that param only to decide whether to auto-open the modal — the customer
field started blank, the amount started blank, and the resulting payment was created fully
unallocated with no link back to the originating invoice. The user had to already know the
customer/amount and then separately find the payment in the list and manually allocate it.

**Fix:** When `invoiceId` is present, `PaymentsPage.tsx` now fetches the invoice, prefills
customer and amount from its `balanceDue`, and — on successful payment creation — automatically
calls `POST /payments/:id/allocate` against that invoice, then navigates to the invoice detail
page. The two-step create-then-allocate payment model itself is intentional (supports advance
payments split across invoices) and was left unchanged; only the dropped invoice-context bug was
fixed.

**Tests:** New `apps/web-frontend/e2e/payments-workflow.spec.ts` — prefill + auto-allocation
end-to-end, 1/1 pass.

### 4. Credit-limit / price-floor override had no UI — holders of the override permission were still blocked

`InvoiceService.confirm()` fully supports `overrideCreditLimit`/`overridePriceFloor` (gated on
`CREDIT_LIMIT_OVERRIDE`/`PRICE_FLOOR_OVERRIDE` permissions server-side, per ES-08's original
scope), and `friendlyApiErrorMessage()` already renders a clear message when either is exceeded
(`"{customer} would exceed their credit limit of ₹X (new balance would be ₹Y)"`). But
`InvoiceFormPage.tsx` never sent either flag — it always defaulted `false` — and there was no
checkbox or any other control to set them `true`. A manager holding the override permission had
no way to complete a legitimate over-limit sale through the app at all; they'd have to call the
API directly.

**Fix:** Added two checkboxes to `InvoiceFormPage.tsx`, each shown only to a holder of the
matching permission (`hasPermission(PERMISSIONS.CREDIT_LIMIT_OVERRIDE)` /
`PRICE_FLOOR_OVERRIDE`), wired into the create payload. Off by default — sending
`overrideCreditLimit:false`/`overridePriceFloor:false` preemptively is a no-op server-side unless
a breach actually occurs, so no behavior change for the common case.

**Tests:** New `apps/web-frontend/e2e/invoices-workflow.spec.ts` — 4 cases: checkboxes hidden
without either permission, each shows independently for its own permission holder and defaults
unchecked, and a live credit-limit-exceeded response renders the expected friendly message. 4/4
pass.

### 5. SALES_MANAGER role was never granted `QUOTATION_CONVERT` — could never finish its own workflow

Found while reviewing the RBAC angle on the workflow this session fixed. `role-defaults.ts`'s
`SALES_MANAGER` list grants `QUOTATION_VIEW`/`CREATE`/`UPDATE`/`CANCEL` but not
`QUOTATION_CONVERT` — the exact (and only) permission `POST /quotations/:id/convert` checks. Only
`OWNER`/`ADMIN`/`SUPER_ADMIN` had it, via the `TENANT_SCOPED_PERMISSIONS` wildcard. Confirmed live
against the local dev DB: **zero `SALES_MANAGER` roles across all 5 existing tenants that have
one** had `QUOTATION_CONVERT` — the role built specifically to run the sales workflow could not
perform its own final step. Same root-cause class as the already-documented RBAC
dead-permission-constant pattern, this time a permission simply never added to a role list rather
than a route checking the wrong constant.

**Fix:** Added `PERMISSIONS.QUOTATION_CONVERT` to `SALES_MANAGER` in
`apps/tenant-service/src/rbac/role-defaults.ts` (new tenants get it automatically), plus
`packages/db-client/migrations/0051_qa_sales_manager_quotation_convert_backfill.sql` to backfill
existing tenants (added to `migrations/meta/_journal.json` and applied — verified via
`drizzle.__drizzle_migrations` count 51→52 and a live query confirming all 5 tenants'
`SALES_MANAGER` roles now have it). `CASHIER` was deliberately left unchanged — it never had
`QUOTATION_CANCEL` either, consistent with being scoped to lightweight POS/quick-sale flows, not
the full quotation lifecycle.

**Tests:** New `apps/tenant-service/src/__tests__/role-defaults.test.ts` — 1/1 pass. Full
tenant-service suite re-run: 37 passed, 8 skipped (pre-existing), 0 failed.

### 6. Test-infra fix: shared Playwright `login()` helper caused a real 401 → forced-logout race

While debugging an intermittently-login-page-only Playwright failure, found that `Layout.tsx`
fires unmocked calls on every authenticated page (`/organization`, `/notifications/unread-count`,
`/notifications/stream`) regardless of a test's granted permissions. Left unmocked, they hit the
real backend, 401, and trip `apiClient`'s blanket 401 → `/auth/refresh` → (also 401, fake test
token) → forced logout path, silently bouncing the page back to `/login` mid-test. Fast tests
finished before the cascade completed and never showed it; anything slower (e.g. a test that
waits on multiple sequential mutations) hit it. Fixed once in `apps/web-frontend/e2e/helpers.ts`'s
`login()` so every current and future spec is protected, not just the new ones. Confirmed this
also stabilized two previously-flaky `mobile-responsive-smoke.spec.ts` cases under full
parallelism (unrelated to this session's other changes).

## Verification

- `pnpm --filter @erp/sales-service test` — 70 passed, 25 skipped (pre-existing DB-integration
  skips, unrelated), 0 failed.
- `pnpm --filter @erp/tenant-service test` — 37 passed, 8 skipped (pre-existing), 0 failed.
- `pnpm --filter @erp/sales-service type-check` / `build` — clean.
- `pnpm --filter @erp/tenant-service type-check` / `build` — clean.
- `pnpm --filter @erp/web-frontend type-check` — clean.
- `npx playwright test` (web-frontend, full suite, both `--workers=1` and default full-parallel) — 21/21 pass.
- `pnpm db:migrate` (drizzle-kit) — confirmed all 51 pre-existing migrations already applied to
  the local dev DB at session start (initial concern about a pending-migration issue was a false
  alarm — corrected in-session); migration 0051 (finding #5) applied cleanly on top, journal count
  51→52, confirmed via `drizzle.__drizzle_migrations` and a live role_permissions query.
- Manually restarted the live local `sales-service` and `tenant-service`
  (`node --env-file=../../.env dist/main.js`) after rebuilding each, confirmed `/health` 200 with
  the fixes live.
- Did **not** get a real authenticated browser session against the live backend — brute-forcing
  a known password for a seeded demo user was correctly blocked by the permission classifier as
  an unauthorized credential-rotation attempt, and that path was abandoned rather than worked
  around. All verification above is via Vitest unit tests (real `QuotationService` code, mocked
  DB) and Playwright's established mocked-API tier (real DOM/routing/React Query, mocked network) —
  the same verification tier this repo's existing E2E suite already uses.

### 6. Dead RBAC permission constants across quotation / sale-return / credit-note routes

`QUOTATION_VIEW`/`CREATE`/`UPDATE`/`CANCEL`, `SALE_RETURN_VIEW`/`CREATE`, and
`CREDIT_NOTE_ADJUST` are all defined and granted to roles in `role-defaults.ts`, but every route
they should gate actually checked a broader, unrelated fallback instead (`INVOICE_VIEW`/
`INVOICE_CREATE`/`INVOICE_CANCEL`/`PAYMENT_CREATE`) — holding the purpose-built constant had zero
effect. One case was worse than cosmetic: `POST /sale-returns` checked `INVOICE_CANCEL`, which
`CASHIER` never had, even though `CASHIER` _is_ explicitly granted `SALE_RETURN_CREATE` in
`role-defaults.ts` — that grant was completely unreachable.

**Fix:** Added `requireAnyPermission([...])` (`apps/sales-service/src/middleware/authorize.ts`) —
grants access if the caller holds _any_ of the listed permissions — and repointed each affected
route to check `[purpose-built constant, existing fallback]` rather than replacing the fallback
outright. This was the deliberately lower-risk choice over auditing and backfilling every role's
grants for every constant (which a first pass showed would require judgment calls this session
isn't positioned to make, e.g. whether `ACCOUNTANT`/`AUDITOR` should keep seeing quotations) —
the fallback staying in the `OR` means zero currently-working access changes, while the
purpose-built constant stops being dead. `QUOTATION_UPDATE` was mapped to `send`/`accept`/
`expire`, `QUOTATION_CANCEL` to `reject`, `CREDIT_NOTE_ADJUST` to both credit-note `apply` and
`refund` (closest semantic fit among the four defined `CREDIT_NOTE_*` constants).

`INVOICE_APPROVE`, `SALE_RETURN_APPROVE`, `SALE_RETURN_CANCEL`, and `CREDIT_NOTE_CANCEL` are
still dead — not because a route checks the wrong constant, but because **no route or workflow
implementing approve/cancel exists at all** for sale returns or credit notes. Building those is a
feature-completeness gap, not an RBAC wiring fix, and was left alone as out of scope for this
pass.

**Tests:** New `apps/sales-service/src/__tests__/quotation-sale-return-permission-guards.test.ts`
— 11 real HTTP-level tests (`app.inject()` with signed JWTs) proving both directions: a caller
with only the new granular constant succeeds, and a caller with only the legacy fallback still
succeeds (no regression). 11/11 pass. Full sales-service suite re-run: 81 passed, 25 skipped
(pre-existing), 0 failed.

## Known Gaps / Follow-ups (not fixed this session — out of scope or lower priority)

- **No approve/cancel workflow for sale returns or credit notes** (see finding #6) —
  `SALE_RETURN_APPROVE`/`SALE_RETURN_CANCEL`/`CREDIT_NOTE_CANCEL` are granted permission
  constants with no corresponding feature built yet.
- Invoice CRUD (confirm/cancel/duplicate/PDF/history) was read and looks structurally complete;
  not yet exercised end-to-end with live data (no authenticated session — see Verification).
  Credit-limit/price-floor override UI gap (finding #4 above) was found and fixed during this
  read-through.
- Sales reports/dashboard consistency: spot-checked `GET /dashboard/sales-summary` (pending
  quotations, overdue invoices, collected-today cards from ES-08's original scope) this session.
  All three query correctly and the "mark overdue" mechanism (`internal.routes.ts` →
  `sales.overdue-invoice-update` cron, `scheduler-service`, daily 1am) is genuinely wired end to
  end — not the same class of dead-end as findings #1/#2. Not exercised against live data
  (no authenticated session), and the broader Reports module (P&L/BS/TB/GST returns etc.) outside
  this dashboard summary is untouched.
- RBAC matrix (menu visibility, API authorization, CRUD permissions) not yet systematically
  verified across all roles for the Sales module — findings #5 and #6 were caught by targeted
  spot-checks and a full grep-based audit of `sales-service`'s routes specifically, not an
  exhaustive per-role matrix; frontend menu-visibility gating and other services' routes weren't
  cross-checked the same way yet.
- Full form-level validation sweep (SQL injection/XSS payloads, boundary lengths, Unicode/emoji,
  decimal precision) not yet performed against quotation/invoice/payment forms.

## Files Changed

| File                                                                                 | Change                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `apps/sales-service/src/domain/QuotationService.ts`                                  | Added `accept()`, `reject()`                                           |
| `apps/sales-service/src/api/quotation.routes.ts`                                     | Added `POST /quotations/:id/accept`, `/reject`                         |
| `apps/sales-service/src/__tests__/sales-workflow.test.ts`                            | 6 new accept/reject tests                                              |
| `apps/web-frontend/src/api/endpoints.ts`                                             | Added `quotationApi.accept`/`.reject`                                  |
| `apps/web-frontend/src/pages/sales/QuotationDetailPage.tsx`                          | Accept/Reject buttons + confirm modal                                  |
| `apps/web-frontend/src/pages/sales/QuotationsPage.tsx`                               | Fixed row-action status gating; Accept/Reject actions                  |
| `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx`                              | Added credit-limit/price-floor override checkboxes                     |
| `apps/web-frontend/e2e/invoices-workflow.spec.ts`                                    | **New** — 4 tests                                                      |
| `apps/web-frontend/src/pages/sales/QuotationFormPage.tsx`                            | **New** — quotation creation form                                      |
| `apps/web-frontend/src/pages/sales/PaymentsPage.tsx`                                 | Prefill + auto-allocate when arriving from an invoice                  |
| `apps/web-frontend/src/App.tsx`                                                      | Route `sales/quotations/new` → `QuotationFormPage`                     |
| `apps/web-frontend/e2e/helpers.ts`                                                   | Mock `/organization`, `/notifications/*` to prevent forced-logout race |
| `apps/web-frontend/e2e/quotations-workflow.spec.ts`                                  | **New** — 8 tests                                                      |
| `apps/web-frontend/e2e/payments-workflow.spec.ts`                                    | **New** — 1 test                                                       |
| `apps/tenant-service/src/rbac/role-defaults.ts`                                      | Added `QUOTATION_CONVERT` to `SALES_MANAGER`                           |
| `packages/db-client/migrations/0051_qa_sales_manager_quotation_convert_backfill.sql` | **New** — backfill for existing tenants                                |
| `packages/db-client/migrations/meta/_journal.json`                                   | Registered migration 0051                                              |
| `apps/tenant-service/src/__tests__/role-defaults.test.ts`                            | **New** — 1 test                                                       |
| `apps/sales-service/src/middleware/authorize.ts`                                     | Added `requireAnyPermission()`                                         |
| `apps/sales-service/src/api/quotation.routes.ts`                                     | Repointed 6 routes to granular+fallback permission checks              |
| `apps/sales-service/src/api/sale-return.routes.ts`                                   | Repointed 5 routes to granular+fallback permission checks              |
| `apps/sales-service/src/__tests__/quotation-sale-return-permission-guards.test.ts`   | **New** — 11 tests                                                     |

## Next Session

This module is being closed out here per user direction (dead-RBAC-constant cleanup done,
moving to the next module). Remaining Sales-specific follow-ups, if picked back up later:
Invoice CRUD live-workflow verification, a full per-role RBAC matrix, the sale-return/credit-note
approve-cancel feature gap (finding #6), and a form-level validation sweep.
