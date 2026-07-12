# [PG-059] Friendly Error Messages & Shared Error Handling

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Medium — not a correctness bug, but a live UX gap that surfaces on every checkout/form failure across both frontends
**Complexity:** L — infra piece is done and small; the remaining content work is ~600 backend call sites and ~185 frontend display sites across 15 services and 2 frontends, necessarily incremental
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `packages/platform-sdk` (new `error-handler.ts`), `packages/shared-types` (`NotFoundError`), all 15 backend services' `main.ts`, `apps/pos-frontend/src/posErrorMessages.ts`, `apps/web-frontend/src/lib/errorMessages.ts`

---

## Overview

- **Business objective:** a cashier at POS checkout (or back-office staff on the invoice/PO forms) who hits a business-rule rejection — insufficient stock, price below floor, over credit limit, etc. — sees a sentence they can act on, not a string built for a developer. The triggering incident: a POS "Complete Sale" click surfaced `"Item 36 min sale price is 23, offered 12"` verbatim in a toast.
- **Current implementation (before this package):** every backend service threw errors via `ERPError`/`BusinessError`/`ValidationError`/`NotFoundError` (from `packages/shared-types/src/errors.ts`) or per-service subclasses, but almost none carried a structured `details` payload — the human-readable text _was_ the only payload, with raw numeric IDs baked in (e.g. `NotFoundError`'s own template: `` `${entity} not found (id: ${id})` ``). Every frontend call site read `error.message` and displayed it as-is.
- **Current architecture (after this package — see Completed Components below):** a single shared `registerErrorHandler(fastify, serviceName, logger)` in `@erp/sdk` now backs all 15 services, replacing 15 hand-rolled (and in 2 cases badly divergent) `setErrorHandler` implementations. `NotFoundError`'s template no longer bakes the id into the message. Two frontend modules (`posErrorMessages.ts`, `errorMessages.ts`) map `error.code` → friendly copy for the highest-traffic checkout/invoice codes, falling back to the raw backend message for anything unmapped.
- **Current limitations:** the friendly-message tables are seeded, not exhaustive. A full codebase audit (see Architecture section below) found ~600 backend throw sites across 15 services and ~185 frontend display sites across `web-frontend`/`pos-frontend` that still surface a raw or semi-raw backend message. Only 2 UI entry points were converted in this package (POS's `POSPaymentPanel`/`saleMutation`, web-frontend's `InvoiceFormPage`). This is deliberate — see the "Sequencing" decision the user made when this package was scoped: infra now, content seeded and grown incrementally, not a one-shot rewrite of every call site.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `packages/platform-sdk/src/error-handler.ts` — the shared Fastify error handler. Handles, in order: `instanceof ERPError` (its own code/message/details/statusCode), `instanceof ZodError` (400, field-path message), Fastify's own AJV `.validation` array (400 — this existed as a bespoke branch in `purchase-service`/`production-service` before, now generic), any other error with a `.statusCode` in [400,500) (400, 500) `.statusCode` in [400,500) — e.g. `@fastify/rate-limit`'s plain `Error` with `.statusCode = 429`, which **no service previously preserved**, so exceeding a rate limit (including `auth-service`'s login rate limit) silently returned 500 everywhere before this package — and finally a generic 500 fallback that logs. Fully unit-tested in `packages/platform-sdk/src/__tests__/error-handler.test.ts` (7 cases covering every branch).
  - `apps/pos-frontend/src/posErrorMessages.ts` — `friendlySaleErrorMessage(error, cart, customer)`. Resolves item/customer names from state already in memory (no extra API call). Covers: `PRICE_FLOOR_VIOLATION`, `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`, `INSUFFICIENT_POINTS`, `DISCOUNT_LIMIT_EXCEEDED`, `PAYMENT_MISMATCH`, `NO_OPEN_SESSION`, `BRANCH_ACCESS_DENIED`, `DUPLICATE_OPERATION_PROCESSING`, `VALIDATION_ERROR`. Wired into `POSScreen.tsx`'s `saleMutation` throw site (the only place `/pos/sales` errors reach the UI).
  - `apps/web-frontend/src/lib/errorMessages.ts` — `friendlyApiErrorMessage(error, context)`, same pattern generalized for `ApiError` (`apps/web-frontend/src/api/client.ts`'s existing class, which already parsed `code`/`message`/`details` but had **zero** call sites actually reading `code`/`details` before this package — 188 sites just read `.message`). Covers `PRICE_FLOOR_VIOLATION`, `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`, `VALIDATION_ERROR`, `NOT_FOUND`. Wired into `InvoiceFormPage.tsx` only, as the seed example.
  - `packages/shared-utils` (`@erp/utils`) already exports `formatIndianCurrency()` (Intl.NumberFormat en-IN) — used by the web-frontend mapper; **pos-frontend still hand-formats `₹${n.toFixed(2)}`** rather than using this — worth reconciling in a later session so both frontends format currency identically (en-IN grouping vs plain toFixed).
  - `InsufficientStockError` now exists in **both** `sales-service/src/domain/InvoiceService.ts` and `inventory-service/src/domain/InventoryLedgerService.ts` (plus `ReservationEngine.ts` reusing inventory-service's) — same error code, same `details` shape (`{itemId, available, requested}`) after this package's fix. If a future consolidation ever merges shared domain error types into a package, these two are the natural first candidates.
- **What should never be modified:** the generic-500 fallback's fixed message (`'An unexpected error occurred'`) — deliberately never echoes the real error text to the client (that only goes to the server log), since some 500s originate from genuinely sensitive internals (DB connection strings, stack traces). Do not "improve" this by including `err.message` in the response body.
- **Prior related work:** none — this is a first pass. `apiclient_discards_sibling_fields.md` (project memory) is a related-but-distinct pre-existing gap (apiClient drops `meta`/`page`/`pageSize` from success responses) — not touched by this package.

## Architecture

**Full audit findings (research pass, not all remediated in this package):**

| Service              | Custom ERPError subclasses             | Missing `details` (before this package) | Inline throw/sendError sites (approx) | ZodError handled (before)                            |
| -------------------- | -------------------------------------- | --------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| sales-service        | 3                                      | 2/3 → **0/3 fixed**                     | ~129                                  | N → **Y (shared handler)**                           |
| inventory-service    | 1 (+2 call sites in ReservationEngine) | 1/1 → **0/1 fixed**                     | ~33                                   | N → **Y**                                            |
| hr-service           | 0                                      | –                                       | ~124                                  | N → **Y**                                            |
| accounting-service   | 0                                      | –                                       | ~84                                   | N → **Y**                                            |
| purchase-service     | 0                                      | –                                       | ~60                                   | N (had AJV-only) → **Y (AJV + Zod)**                 |
| gst-service          | 0                                      | –                                       | ~48                                   | N → **Y**                                            |
| auth-service         | 0                                      | –                                       | ~44                                   | **No ERPError branch at all** → **Y, full envelope** |
| tenant-service       | 0                                      | –                                       | ~28                                   | N → **Y**                                            |
| production-service   | 0                                      | –                                       | ~30                                   | N (had AJV-only) → **Y (AJV + Zod)**                 |
| scheduler-service    | 0                                      | –                                       | ~16                                   | N → **Y**                                            |
| notification-service | 0                                      | –                                       | 8                                     | N → **Y**                                            |
| search-service       | 0                                      | –                                       | 6                                     | N → **Y**                                            |
| report-service       | 0                                      | –                                       | 5                                     | N → **Y**                                            |
| event-service        | 0                                      | –                                       | 0                                     | N → **Y**                                            |
| api-gateway          | 0                                      | –                                       | 0 (proxy-only)                        | **No setErrorHandler at all** → **Y**                |

Content-layer (friendly message tables) status: only the codes listed under "Existing Code Analysis" above are mapped, in only 2 UI entry points. Everything else still displays the raw (but now better-structured) backend message.

**10 worst raw-message examples found by the audit, ranked by how likely a real user sees them — none fixed by this package except #1 and #10:**

1. ~~`InvoiceService.ts:41` `PRICE_FLOOR_VIOLATION`~~ — **fixed** (details added, POS mapping added).
2. `InvoiceService.ts:35` `CREDIT_LIMIT_EXCEEDED` — **details added**, but only mapped in POS + `InvoiceFormPage`; every other invoice/PO/quotation form still shows the raw string.
3. ~~`InventoryLedgerService.ts:23` `Insufficient stock. Available: X` (no itemId at all)~~ — **fixed** (itemId/requested added to all 4 throw sites, POS+web mapping added for the sales-service twin).
4. `PaymentService.ts:83` / `purchase-service/SupplierPaymentService.ts:121` — `Cannot allocate X — only Y unallocated` — raw unformatted amounts, not touched.
5. `purchase-service/PurchaseOrderService.ts` (~5 sites) — `Cannot approve PO in status ${po.status}` — surfaces an internal enum value, not touched.
6. `accounting-service/JournalEngine.ts:78` — `Account ${id} is inactive` — raw numeric account ID, not touched.
7. `pos.routes.ts:348` `PAYMENT_MISMATCH` — has ₹ but no thousands separator — mapped in POS's table but the underlying formatting is unchanged (uses the raw backend string, not a re-formatted one).
8. `production-service/ConsignmentService.ts:155` — raw item ID, not touched.
9. `SaleReturnService.ts:72` — `Invoice line ${rl.invoiceLineId} not found` — raw internal PK, not touched (this is a `NotFoundError` call site though, so it at least no longer doubles the id into a redundant "(id: X)" suffix after this package's base-class fix).
10. ~~`packages/shared-types/src/errors.ts:21` `NotFoundError` base template~~ — **fixed** — this was systemic (hit by hundreds of call sites); the id is no longer baked into the message, and a second latent bug (double-suffixing when a call site passes an already-suffixed entity string, e.g. `new NotFoundError('Customer not found')` → old output `"Customer not found not found"`) was fixed in the same one-line change.

**Decision framework for extending the friendly-message tables (apply per code, not in bulk):**

1. Does the code appear in `details` with enough structure to build a real sentence (an ID that resolves to a name the caller already has in state, an amount to currency-format)? If yes, add a mapped case.
2. Is the code genuinely rare/edge-case (e.g. `BRANCH_ACCESS_DENIED` shouldn't normally fire given existing UI guards)? Lower priority — the raw backend message is an acceptable fallback for something a normal user flow can't trigger.
3. Never invent an "ask a manager to override" hint for a guard that has no override path wired (price floor and credit limit currently have **no override at POS** — `InvoiceService` supports `overridePriceFloor`/`overrideCreditLimit` params, but `pos.routes.ts` never passes them through, unlike the discount guard which does check `DISCOUNT_OVERRIDE`). Wiring an override path is a separate, explicit product decision — not bundled into this package.

## Database Changes

Not applicable — no schema changes. `details` is an in-memory field on `ERPError` subclasses, serialized into the JSON response body, never persisted.

## Backend

- Remaining backend work (per service, priority order by call-site count and user-facing frequency): `sales-service` (~129 sites, highest traffic — start with `PaymentService.ts`, `SaleReturnService.ts`), `hr-service` (~124 sites — payroll/attendance forms), `accounting-service` (~84 sites — journal/ledger forms), `purchase-service` (~60 — PO approval flow per finding #5 above), `gst-service` (~48), then the remaining 9 services roughly by size.
- Per call site being converted: add a `details` object capturing whatever identifiers/amounts are already in scope at the throw (no new DB queries just for messaging — if the data isn't already fetched, leave the code as a plain message rather than adding a query solely for error-copy purposes).
- `NotFoundError` call sites specifically: no code change needed per-site (the base-class fix already applies everywhere) — but any site passing a raw internal PK as the `entity` string instead of using the `(entity, id)` two-arg form (e.g. `SaleReturnService.ts:72`'s `` `Invoice line ${rl.invoiceLineId} not found` ``) should be converted to `new NotFoundError('Invoice line', rl.invoiceLineId)` so the id lands in `details` instead of the message.

## Frontend

- **pos-frontend:** extend `posErrorMessages.ts`'s switch as new codes are found painful in practice (it's a single function, single file — no architectural work needed, just add cases). Reconcile currency formatting with `formatIndianCurrency` from `@erp/utils` at some point (currently hand-rolled `₹${n.toFixed(2)}`, inconsistent with web-frontend's en-IN grouped format).
- **web-frontend:** `errorMessages.ts` is wired into exactly one page (`InvoiceFormPage.tsx`). The highest-value next targets are the pages whose `onError` currently does bare `toast.error(e.message)` on a form that can trigger `PRICE_FLOOR_VIOLATION`/`INSUFFICIENT_STOCK`/`CREDIT_LIMIT_EXCEEDED`/`INSUFFICIENT_POINTS`: purchase order forms, sale-return forms, stock-adjustment forms, payment-allocation forms. Each needs its own `context` (items/customer names) built from whatever state that page already holds, same pattern as `InvoiceFormPage`.
- Neither frontend module needs new components or state — this is purely a mapping-function-plus-wiring pattern, repeated per page.

## API Contract

- No endpoint signatures changed. Response _shape_ for error bodies is now consistent: `{ error: { code, message, details } }` for every service (previously `auth-service` sent a flat `{ error: "string" }` and `api-gateway` had no handler at all — both now match the standard envelope). Any external API consumer that was parsing `auth-service`'s old flat-string error shape would need to switch to reading `error.message` from the object instead — checked both in-repo frontends already defensively handle both shapes (`pos-frontend/LoginScreen.tsx` explicitly branches on `typeof err === 'string'`; `web-frontend/api/client.ts`'s `ApiError` construction already did `err.code ?? 'UNKNOWN'` / `err.message ?? '...'`, so it was silently degrading before and now gets the real values) — no known external consumers of `auth-service`'s raw HTTP API exist outside these two frontends.

## Multi-Tenant Considerations

Not applicable — error messages carry no tenant-scoped data beyond what the triggering request's own tenant already sent (item names, customer names, amounts are all within the caller's own tenant scope by construction, since they come from rows the caller's own query already fetched).

## Integration

- `packages/platform-sdk`'s `registerErrorHandler` is now a hard dependency of all 15 services' bootstrap — any _new_ service added to this monorepo should call it from day one rather than hand-rolling a `setErrorHandler` (there is no lint rule enforcing this yet; consider adding one alongside PG-014's existing "every permission constant must be enforced" CI-guard pattern, i.e. a small test asserting every `apps/*/src/main.ts` imports `registerErrorHandler` and never defines its own `setErrorHandler`).
- `@fastify/rate-limit`'s 429-preservation fix (see Architecture) applies automatically to every service that registers the rate-limit plugin — no per-service action needed, this was a side effect of the shared handler, not a targeted fix.

## Coding Standards

- Friendly-message mapper functions follow one pattern, established in both `posErrorMessages.ts` and `errorMessages.ts`: a `switch` on `error.code`, each case building a sentence from `error.details` plus a small `context` object of already-in-memory names, a `default` that returns `error.message` verbatim. Do not add a generic i18n/templating layer for this — the volume (a few dozen codes, ever) doesn't justify one, and the existing pattern is easy to grep and extend.
- Backend `details` objects: always plain, JSON-serializable, and named after the field they represent (`itemId`, not `id`; `available`/`requested`, not `have`/`want`) — match the naming already established by `InsufficientStockError`, the first class to do this correctly.

## Performance

Not applicable — error paths are not hot paths; the shared handler does the same work (an `instanceof` chain) the 15 bespoke handlers already did, no measurable difference.

## Security

- The generic-500 fallback's behavior (log the real error server-side, return a fixed generic string client-side) is unchanged and remains the correct posture — verified by `error-handler.test.ts`'s "does not leak the raw error message for a genuinely unexpected (5xx-shaped) error" case.
- `auth-service` switching from a hand-rolled handler to the shared one means its `ERPError`-thrown errors (`NotFoundError`, `ValidationError`, `BusinessError`, `PermissionError` — used extensively in `roles.ts`/`users.ts`/`rules.ts`) now correctly return their real `code`/`details` instead of being silently flattened. This is strictly more informative to the client than before; nothing previously hidden becomes newly exposed (the old handler already returned the real `error.message` for anything with a `.statusCode`, just not the `code`/`details` alongside it).

## Testing

- `packages/platform-sdk/src/__tests__/error-handler.test.ts` — 7 tests covering every branch of the shared handler (ERPError, BusinessError, ZodError, AJV validation, rate-limit-style statusCode passthrough, generic 500 fallback, no-leak verification).
- `apps/pos-frontend/src/__tests__/posErrorMessages.test.ts` — 8 tests, one per mapped code plus fallback behavior.
- `apps/web-frontend/src/lib/__tests__/errorMessages.test.ts` — 6 tests, same pattern.
- Existing suites re-run clean after this package: `@erp/types` (20 tests), `@erp/sdk` (116 + 7 new), `@erp/sales-service` (64 passed / 25 pre-existing DB-gated skips), `@erp/inventory-service` (33 passed / 15 pre-existing DB-gated skips), `@erp/pos-frontend` (128 passed — 1 unrelated pre-existing Playwright/vitest config collision in `e2e/checkout-smoke.spec.ts`, untracked file from concurrent work, not touched), `@erp/web-frontend` (160 passed). All 15 backend services + both shared packages build clean with zero TypeScript errors.
- Not yet covered: no test asserts that every `main.ts` actually calls `registerErrorHandler` (the CI-guard mentioned in Integration above) — worth adding if a 16th service is ever added and someone reverts to a bespoke handler by copy-paste habit.

## Acceptance Criteria

- [x] `NotFoundError`'s base template no longer bakes a raw numeric id into the user-facing message, and no longer double-suffixes when called with an already-suffixed entity string.
- [x] A single shared `registerErrorHandler` exists in `@erp/sdk`, handling `ERPError`, `ZodError`, Fastify AJV validation, and non-ERPError statusCode passthrough (fixing the rate-limit-429-becomes-500 regression found across all 15 services).
- [x] All 15 services (`sales`, `inventory`, `accounting`, `gst`, `production`, `report`, `event`, `hr`, `purchase`, `tenant`, `scheduler`, `search`, `notification`, `auth`, `api-gateway`) use the shared handler instead of a bespoke one.
- [x] `sales-service`'s `CreditLimitExceededError`/`PriceFloorViolationError` and `inventory-service`'s `InsufficientStockError` (plus its `ReservationEngine.ts` call site) carry structured `details`.
- [x] POS checkout (`POST /pos/sales`) errors display cashier-facing copy for the 10 most common codes, with item/customer names resolved from in-memory state.
- [x] `web-frontend`'s `InvoiceFormPage` demonstrates the same pattern for back-office staff, as the seed for extending to other forms.
- [ ] **Not done in this package** — the remaining ~600 backend call sites across the other 13 services and ~180 remaining frontend display sites are unconverted (raw or semi-raw messages still shown). This was an explicit scope decision (see Overview) — extend incrementally per the Backend/Frontend sections above, prioritized by call-site count and real-user frequency, not all at once.
- [ ] **Not done** — no CI guard yet prevents a future service from bypassing `registerErrorHandler` with a hand-rolled handler.

## Deliverables

- **Files created:** `packages/platform-sdk/src/error-handler.ts`, `packages/platform-sdk/src/__tests__/error-handler.test.ts`, `apps/pos-frontend/src/posErrorMessages.ts`, `apps/pos-frontend/src/__tests__/posErrorMessages.test.ts`, `apps/web-frontend/src/lib/errorMessages.ts`, `apps/web-frontend/src/lib/__tests__/errorMessages.test.ts`, this file.
- **Files modified:** `packages/shared-types/src/errors.ts` (`NotFoundError`), `packages/platform-sdk/src/index.ts` (export), all 15 services' `apps/*/src/main.ts` (or `app.ts` for `api-gateway`), `apps/sales-service/src/domain/InvoiceService.ts` (2 error classes' `details`), `apps/sales-service/src/domain/LoyaltyService.ts` (`INSUFFICIENT_POINTS` `details`), `apps/inventory-service/src/domain/InventoryLedgerService.ts` + `ReservationEngine.ts` (`InsufficientStockError` `details`), `apps/pos-frontend/src/POSScreen.tsx` (wired mapper into `saleMutation`), `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx` (wired mapper into `createMutation`).
- **Migrations:** none.
- **APIs added/changed:** none (error response _shape_ standardized, no path/method changes — see API Contract).
- **Events added/changed:** none.
- **Tests added:** 21 new tests (7 + 8 + 6) across the three new modules, described in Testing above.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** triggered by a POS "Complete Sale" click showing a raw backend string (`"Item 36 min sale price is 23, offered 12"`) to a cashier. A codebase-wide audit (via a research subagent) found this was systemic: ~600 backend throw sites across 15 services, only 4 with named error subclasses, none catching `ZodError`, no shared error-handling package, ~185 frontend sites just displaying `error.message` raw. User chose "infra now, content seeded and growing" over either "infra only" or "cover everything in one session" — this package is that first increment.

**Current Objective:** the infra layer (shared backend handler, `NotFoundError` fix, `details` enrichment for the codes involved in the original incident) is complete and applies everywhere. The content layer (friendly-message tables) is seeded for POS checkout and one web-frontend form, with an explicit, documented plan for extending it incrementally.

**Architecture Snapshot:** `packages/platform-sdk/src/error-handler.ts`'s `registerErrorHandler(fastify, serviceName, logger)` is now the single call every service's bootstrap makes instead of a bespoke `setErrorHandler`. Frontend mapper functions (`posErrorMessages.ts`, `errorMessages.ts`) are plain `switch`-on-`code` functions taking an in-memory `context` object, wired at specific `onError`/throw sites, not globally intercepted — each page/screen that wants friendly errors must explicitly call the mapper.

**Completed Components:** see Acceptance Criteria's checked items above.

**Pending Components:** see Acceptance Criteria's two unchecked items — the bulk of the remaining ~600 backend sites and ~180 frontend sites, plus the CI guard against future bespoke handlers.

**Known Constraints:** price floor and credit limit have no manager-override path at POS today — do not phrase a friendly message as if one exists ("ask a manager to override") unless a future package explicitly wires `overridePriceFloor`/`overrideCreditLimit` through `pos.routes.ts` (the discount guard is the only one with a real override today, via `DISCOUNT_OVERRIDE`).

**Coding Standards:** switch-on-code mapper functions, plain JSON-serializable `details` objects named after their field (see Coding Standards section above) — no new i18n/templating layer, no new shared "error message" package (kept per-frontend since audience/tone differs).

**Reusable Components:** `registerErrorHandler` (backend, all future services should use it from day one), the two frontend mapper functions as the pattern to replicate per-page (not a shared component — each page builds its own `context`), `formatIndianCurrency` from `@erp/utils` (web-frontend already uses it for this; pos-frontend should adopt it too instead of hand-rolled formatting).

**APIs Already Available:** none new — same endpoints, standardized error envelope.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/types` (`ERPError`/`NotFoundError`/`BusinessError`/`ValidationError`/`PermissionError`), `@erp/sdk` (`registerErrorHandler`), `@erp/utils` (`formatIndianCurrency`).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** not applicable — see Multi-Tenant Considerations above.

**Security Rules:** the 500-fallback must never echo the real internal error message to the client — verified by an explicit test; do not "fix" this by including more detail in 5xx responses.

**Database State:** unaffected — no migrations in this package.

**Testing Status:** 21 new tests, all passing; full test suites for `@erp/types`, `@erp/sdk`, `@erp/sales-service`, `@erp/inventory-service`, `@erp/pos-frontend`, `@erp/web-frontend` re-run clean (one unrelated pre-existing failure noted in Testing above, not caused by this package). All 15 backend services + both touched shared packages build with zero TypeScript errors.

**Next Session Plan:** pick the next-highest-traffic service from the Backend section's priority list (likely `sales-service`'s remaining `PaymentService.ts`/`SaleReturnService.ts`, or `purchase-service`'s PO-approval-status messages per audit finding #5) and the next-highest-traffic web-frontend form (purchase order or stock adjustment), add `details` to the relevant error throws, extend the two mapper functions' switch statements, wire the mapper into that page's `onError`. Re-run this same audit-and-extend cycle per service/page rather than attempting a full rewrite in one session — the volume doesn't fit in one context window's worth of careful, tested work.

**Prompt for the Next Session:** "Implement the next increment of `ERP-PLANNING/production-gap-prompts/001-Architecture/59-friendly-error-messages-and-shared-error-handling.md` (PG-059). Before starting, re-check whether concurrent work has already converted any of the call sites listed in this doc's Architecture/Backend/Frontend sections (this repo has multiple concurrent sessions active — re-grep before assuming a site is still raw). Pick one service and one frontend page from the priority lists, add `details` to its business-error throws, extend `posErrorMessages.ts`/`errorMessages.ts`'s switch statements for any new codes, wire the mapper into that page's error handler, and add tests following the exact pattern in the three test files this package created."
