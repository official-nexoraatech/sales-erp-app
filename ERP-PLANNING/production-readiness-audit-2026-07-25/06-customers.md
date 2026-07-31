# Customers Module — Production Readiness Audit (Fresh, 2026-07-25)

Scope: customer master-data CRUD, addresses, GST/financial fields, list/search/filter,
credit limit enforcement, branch/tenant scoping, RBAC, delete/merge, tests.
`apps/sales-service/src/api/customer.routes.ts` (backend) +
`apps/web-frontend/src/pages/customers/*` (frontend).

All findings below were verified live against the running stack (gateway :3000 → sales-service
:3013, tenant 2 "QA E2E Test Co") unless explicitly marked "code-only". Test customers created
during this audit (ids 920–923) were soft-deleted at the end of the session.

## Summary

Core CRUD, RBAC enforcement, tenant isolation, multi-branch address/billing storage, and
global-search indexing for customers are all solid and live-verified. However, this audit found
**one severe, previously-undetected UX/data gap** — credit-limit enforcement, which is correctly
built and enforced server-side, has **no UI control anywhere** to turn it on, making a real,
working backend feature permanently unreachable through the app — plus a cluster of smaller but
concrete bugs: GSTIN search is advertised but non-functional, a PUT silently zeroes GSTIN/PAN if
omitted, an RBAC dead-permission-constant blocks the SALES_MANAGER role from ever opening the
edit form, shipping addresses have no UI at all despite full backend support, list-page sorting
is fake (client-side only, no backend `ORDER BY`), and customer list/detail routes are the one
place in sales-service that skips branch scoping entirely. The 2026-07-05 "customer creation
100% broken" bug is confirmed fixed with no regression. Sales-service's own test suite for
customers is currently useless for regression protection (6/8 unit tests always fail on 401 due
to an unrelated JWT-issuer mismatch), though the 5 live-DB integration tests and 8 frontend tests
pass cleanly.

## What Works (live-verified)

- **Full CRUD round-trip**, including **both** billing and shipping addresses, GSTIN, PAN, credit
  terms, opening balance: created customer id `920` with billing (Mumbai) + shipping (Pune)
  addresses, GSTIN, PAN, credit limit 50000/30 days — all fields persisted correctly on GET.
  (The backend supports shipping address fully; see gap below re: frontend.)
- **Validation is clean, not 500s**: invalid GSTIN format → `422 VALIDATION_ERROR "Invalid GSTIN
format"`; missing `phone` → `422 "Required"`; missing `branchId` → `422 "Required"`.
- **Optimistic locking works**: PUT with a stale `version` → `409 OPTIMISTIC_LOCK_CONFLICT`
  with a clear message; correct version → `200` and `version` increments.
- **Credit limit enforcement is real and correctly wired** (not decorative) — verified in
  `apps/sales-service/src/domain/InvoiceService.ts` lines ~165-209: on invoice creation, if
  `customer.creditLimitEnabled` is true, current balance + new invoice total is checked against
  `creditLimit` and throws `CreditLimitExceededError` (422) if exceeded, overridable only with
  `CREDIT_LIMIT_OVERRIDE`. **The catch is the UI can never set `creditLimitEnabled=true` — see
  Critical gap #1 below.**
- **Blocked/inactive customers cannot be invoiced** (H-3 fix, confirmed present):
  `InvoiceService.ts` throws `CUSTOMER_BLOCKED`/`CUSTOMER_INACTIVE` `BusinessError`s before
  allowing invoice creation.
- **Block/unblock flow** (`POST /customers/:id/block`, `/unblock`) works and is properly gated by
  `CUSTOMER_BLOCK`, with history rows and audit logging.
- **Soft delete works cleanly**: `DELETE /customers/922` → `200`; subsequent `GET` → `404`; list
  search no longer returns it. Confirmed via live test.
- **RBAC enforced correctly at the API layer**: logged in as `cashier@qa-e2e.local` (has
  `CUSTOMER_CREATE` + `CUSTOMER_VIEW` only) — `POST /customers` → `201` succeeded,
  `PUT`/`DELETE` → `403 FORBIDDEN` with the correct missing-permission name. OWNER/ADMIN get full
  access via the "all tenant-scoped permissions" default set.
- **Tenant isolation**: every query in `customer.routes.ts` (list, get-by-id, statement,
  outstanding, activity, block/unblock, delete, merge) includes `eq(customers.tenantId,
tenantId)` from the authenticated JWT — code-verified across all 10+ routes, no path skips it.
- **Global search-service indexing is fast and correct**: created customer id `921` at
  `21:15:28.686Z`, found via `search-service` (port 3017, real ES) at `_indexed_at:
21:15:29.233Z` — well under 1 second. `CUSTOMER_CREATED`/`UPDATED`/`DELETED` are all mapped in
  `eventEntityMap.ts`. This is a **separate** feature from the list-page search box (see gap
  below) and works well.
- **2026-07-05 "customer creation 100% broken" bug: confirmed still fixed.** Created several
  customers across OWNER, SALES_MANAGER-equivalent, and CASHIER-permission callers with no
  branchId/address issues; `branchId` is a required field the frontend now defaults from
  `user.branchIds` when the user has exactly one branch (`CustomerFormPage.tsx` lines 78-82).
- **Pagination metadata survives `apiClient.get()`'s `.data`-unwrapping** — unlike the generic
  concern in project memory, the sales-service customer-list response nests
  `{content, totalElements, page, size}` _inside_ `data`, so `apiClient.get<T>()`'s unwrap to
  `.data` returns the whole pagination envelope intact, not just the array. `CustomersPage.tsx`
  correctly reads `data.content` / `data.totalElements`.
- **Frontend tests pass**: `CustomersPage.test.tsx` — 8/8 passed (permission-gated actions, axe
  a11y, URL-synced debounced search).
- **DB integration tests pass**: `customer.integration.test.ts` (5/5, run live against Postgres
  on :5435) — tenant scoping, communication-preferences cleanup all correct.

## Bugs / Gaps Found

### Critical

**1. Credit-limit enforcement is unreachable from the UI — `creditLimitEnabled` has no frontend
control anywhere, in create, edit, or view.**

- Evidence: `apps/web-frontend/src/schemas/customer.schema.ts` (`customerFormSchema`) has no
  `creditLimitEnabled` field at all; `CustomerFormPage.tsx`'s "Credit Terms" section has only
  Credit Limit / Credit Days / Opening Balance inputs, no enable toggle;
  `CustomerViewPage.tsx` shows Credit Limit/Days/Opening Balance cards but never displays whether
  enforcement is on. Grep for `creditLimitEnabled` across `apps/web-frontend/src` finds it **only**
  in the **supplier** form (`SupplierFormPage.tsx` has a working `<Checkbox label="Enable Credit
Limit">` bound to `register('creditLimitEnabled')`) — the identical control was apparently built
  for suppliers and never ported to customers.
- Live confirmation: `CustomerSchema` on the backend has `creditLimitEnabled: z.boolean().default(false)`
  — since the field is a Zod `.default()` (not `.optional()`), **any** PUT that omits it (which is
  every PUT the current UI can ever send, since the field doesn't exist in the form) resets it to
  `false`. Created a customer via raw API with `creditLimitEnabled: true`, then submitted a
  PUT shaped exactly like the frontend's payload (no `creditLimitEnabled` key) — the field
  silently flipped back to `false` in the response.
- Business impact: the credit-limit-block-on-invoice feature (verified working, see above) can
  only ever be turned on by a direct API call, never through the app. For all practical purposes
  this shipped, tested backend feature is dead weight — every real customer created through the
  UI has credit-limit enforcement permanently off, and editing a customer that had it on via API
  will silently turn it back off on next save.
- Severity: **Critical** (a correctly-built, security/financial-control feature is completely
  unreachable by any real user, and editing an existing customer silently disables it).

### High

**2. GSTIN search is advertised but does not work.**

- The customer-list search box's placeholder literally says `"Search name, phone, GSTIN…"`
  (`CustomersPage.tsx` line 179), but `GET /customers?search=` (`customer.routes.ts` lines
  161-171) only ORs `ilike()` across `displayName`, `phone`, `email`, `customerCode` — **GSTIN is
  never included**.
- Live confirmation: created customer id `921` "GSTIN Search Test Co" with GSTIN
  `29AAACT2727Q1ZW`; `GET /customers?search=29AAACT2727Q1ZW` returned `totalElements: 0`.
- Migration `0100_customer_search_indexes.sql` even adds trigram indexes for
  phone/email/customer_code specifically to speed up this same ILIKE search, but never added one
  for `gstin` — consistent with GSTIN having been omitted from the search clause itself, not just
  the index.
- Business impact: a very common real workflow — "look up this customer by their GSTIN before
  invoicing" — silently returns nothing, with no error, indistinguishable from "no such
  customer."

**3. `PUT /customers/:id` silently nulls `gstin`/`pan` when the caller omits them — inconsistent
with every other optional field.**

- Code: lines 474-486 of `customer.routes.ts` — `.set({...body.data, gstin: body.data.gstin ||
null, gstinHash, pan: body.data.pan || null, panHash, ...})`. The explicit `gstin: ... || null`
  override means the column is _always_ written, regardless of whether the client sent the field.
  By contrast, `billingAddress`/`shippingAddress`/`notes`/`tags` are only ever set via the
  `...body.data` spread, so omitting them from a PUT correctly leaves the existing DB value
  untouched (verified: a PUT omitting both addresses preserved both correctly).
- Live confirmation: PUT'd customer `920` with a payload matching exactly what the current
  frontend form would send (no `gstin`/`pan` keys, since edit-mode reset should normally
  re-populate them from the loaded record) — `gstin` and `pan` came back `null` in the response.
  Billing/shipping addresses sent in the same request without being re-included stayed intact.
- Business impact: this specific scenario is _usually_ masked in the standard edit flow because
  `CustomerFormPage.tsx`'s `reset(customer)` on load repopulates the GSTIN/PAN inputs from the
  fetched record, so a normal "load → edit something else → save" round-trip resends the existing
  value. But it is a live landmine for: any future partial-update/PATCH-style caller, the
  offline-sync retry path, bulk import, or any frontend bug that leaves those fields blank on
  submit — all of which would silently strip a real customer's GST registration with no warning,
  no audit-log distinction from an intentional clear, and no error.

**4. RBAC dead-permission-constant blocks `SALES_MANAGER` from ever opening the customer edit
form — button shows, then bounces to "no permission."**

- `apps/web-frontend/src/App.tsx` line 716: the `/customers/:id/edit` route's `PermissionRoute`
  checks `PERMISSIONS.CUSTOMER_UPDATE`. But every other customer-edit gate in the app —
  `CustomersPage.tsx`'s Edit row-action, `CustomerViewPage.tsx`'s Edit button, and the **backend**
  `PUT /customers/:id` route itself — all check `PERMISSIONS.CUSTOMER_EDIT`, a _different_
  permission constant.
- Live confirmation: logged in as `sales.manager@qa-e2e.local` and decoded its JWT — permission
  set includes `CUSTOMER_EDIT` but **not** `CUSTOMER_UPDATE`
  (`apps/tenant-service/src/rbac/role-defaults.ts` grants `CUSTOMER_EDIT` to `SALES_MANAGER`
  explicitly at line 52 but never mentions `CUSTOMER_UPDATE` anywhere in the file — it only
  exists implicitly in OWNER/ADMIN's "all permissions" catch-all set).
- Business impact: for the `SALES_MANAGER` role — the role explicitly seeded to manage customers
  — the Edit button is visible (correctly, per `CUSTOMER_EDIT`), clicking it navigates to
  `/customers/:id/edit`, and the route guard then blocks the page with a "no permission" screen,
  even though the backend would have accepted the PUT. This is the same class of bug flagged
  repeatedly in prior audits ("RBAC dead-permission-constant pattern") — here it manifests as a
  genuine dead-end in a core workflow for a non-admin role, not just an unused constant.

### Medium

**5. Shipping address has zero frontend UI — create, edit, and view all only handle billing.**

- Backend `CustomerSchema` fully supports an independent `shippingAddress` object (verified live:
  created customer `920` with a different billing and shipping address, both persisted
  correctly). But `apps/web-frontend/src/schemas/customer.schema.ts` has no `shippingAddress.*`
  fields at all, `CustomerFormPage.tsx` has only a "Billing Address" section, and
  `CustomerViewPage.tsx` only ever reads/renders `customer.billingAddress`. Grep for
  `shippingAddress` across the entire `web-frontend/src` tree: zero matches.
- Business impact: any tenant that ships to a different address than they bill to (common for
  B2B/wholesale/export customer types, all of which exist as `customerType` options) cannot
  record it anywhere in the app, despite the data model and API fully supporting it.

**6. Customer list has no server-side sort and no `ORDER BY` at all — "sortable" columns only
sort the current page.**

- `GET /customers` (`customer.routes.ts` lines 173-178) has no `.orderBy()` clause whatsoever —
  rows come back in whatever order Postgres's query planner happens to produce, which is not
  guaranteed stable across repeated calls, and the route accepts no `sort`/`sortDir` query param.
- `ERPDataGrid`'s sort arrows on `CustomersPage.tsx` (`customerCode`, `displayName`, `status`
  marked `sortable: true`) only do client-side sorting of whatever's already in `data` (confirmed
  in `ERPDataGrid.tsx` lines 264-276: `onSortChange` is undefined here, so it falls into the
  client-side branch) — meaning "Sort by Name" only reorders the 50 rows on the current page, not
  the full customer list, which will look broken/confusing to a user who doesn't realize this.
- Live pagination test (27 total customers, page size 5): two consecutive fetches of page 0
  returned identical order, and pages 0/1 had no ID overlap — so this happened to be stable in
  this low-write dev environment, but nothing in the code guarantees it under concurrent writes,
  autovacuum, or a different query plan. This is the same bug class flagged before for the
  employee list (2026-07-13, "zero ORDER BY affecting 5 frontend pages") — customers was not
  covered by that fix and has the identical defect today.

**7. No duplicate-GSTIN detection — only phone is checked, and duplicate customers with the same
GSTIN are trivially created.**

- `customer.routes.ts` lines 350-367 (`POST /customers`) only checks for an existing customer
  with the same `phone`; there is no equivalent check against `gstin`.
- Live confirmation: created customer `922` "Duplicate GSTIN Test Co" with the exact same GSTIN
  (`29AAACT2727Q1ZW`) as the already-existing customer `921` — `201 Created`, `warnings: []`
  (empty — no warning at all). Two live customer master records now legitimately existed in the
  same tenant with an identical GSTIN.
- Business impact: GSTIN is a far stronger dedup signal than phone for B2B customers (a business
  entity's GSTIN is effectively unique per state); this gap directly causes the kind of
  fragmented customer master data (double-counted revenue in per-customer reports, split credit
  limits, confused GST reconciliation) that duplicate detection exists to prevent.

**8. Customer list/detail routes are the one place in sales-service that skips branch scoping.**

- Code-verified by contrast: `apps/sales-service/src/api/invoice.routes.ts`,
  `pos.routes.ts`, `crm.routes.ts`, and `sync.routes.ts` all call `getBranchScope(auth)`
  (`packages/platform-sdk/src/auth.ts`) to restrict results to the caller's assigned branches
  unless they hold `BRANCH_SCOPE_BYPASS` or have no branch assignment. `customer.routes.ts` has
  **zero** references to `getBranchScope` or `branchIds` anywhere in the file — `GET /customers`
  and `GET /customers/:id` only filter by `tenantId`, never by branch.
- Could not demonstrate this live end-to-end: every seeded QA test user (including
  `sales.manager@qa-e2e.local`) has `branchIds: []` in their JWT, which `getBranchScope()` treats
  as "sees everything" by design — none of the seeded credentials in `TEST_CREDENTIALS.md`
  represent a genuinely branch-restricted user, so there was no live account to prove the
  contrast with. The gap is nonetheless clear from direct code comparison against the sibling
  route files that implement the identical requirement correctly.
- Business impact: in a real multi-branch tenant, a user restricted to Branch A (a common,
  realistic setup — e.g. a branch cashier/manager) would still see and be able to open every
  customer record from every other branch in the tenant via the Customers module, even though the
  equivalent Invoices/POS/CRM modules correctly restrict them.

**9. `DELETE /customers/:id` doesn't check for outstanding balance, and `POST
/customers/merge` doesn't repoint the merged-away customer's transactions — both explicitly
flagged as incomplete in the code itself, not fully verifiable end-to-end without pre-existing
invoice data.**

- `customer.routes.ts` line 861: `// TODO Phase 5: block if customer has outstanding balance` —
  currently a customer with a nonzero balance can be soft-deleted with no warning.
- Since `GET /customers/:id` filters `isNull(customers.deletedAt)`, any other part of the app
  that re-fetches a soft-deleted customer's details by ID (e.g. hydrating an old invoice's
  customer name) would 404 — this was not directly tested against a real invoice due to the
  shared/concurrent dev-tenant risk (did not want to soft-delete a customer with real invoice
  history used by other QA sessions), but follows directly from the code path.
- `customer.routes.ts` line 937: `// Soft-delete source (all transactions Phase 5+ will re-point
to target)` — `POST /customers/merge` only archives + soft-deletes the source customer; it does
  not touch invoices/payments/loyalty records at all, so "merging" two customers does not actually
  consolidate their transaction history, just hides one of the two records.
- The merge feature also has **no frontend UI at all** — `customerApi.merge()` exists in
  `apps/web-frontend/src/api/endpoints.ts` but is never called from any page (grepped the entire
  frontend `src` tree). It is reachable only via direct API call.

### Low

**10. `CUSTOMER_CREDIT_LIMIT_UPDATE`, `CUSTOMER_UPDATE`, `CUSTOMER_CREDIT_LIMIT_VIEW`,
`CUSTOMER_STATEMENT_VIEW`, `CUSTOMER_IMPORT`, `CUSTOMER_EXPORT` are dead permission constants**
— defined in `packages/shared-types/src/permissions.ts`, granted to roles in
`role-defaults.ts`/`App.tsx`, but never checked by any actual route in `customer.routes.ts` (which
uses `CUSTOMER_EDIT` and `EXPORT_CUSTOMER_DATA` instead for the equivalent operations). Consistent
with the previously-documented "RBAC dead-permission-constant" pattern; not a live security
issue since the routes fall back to permissions that are at-least-as-restrictive, but it's
misleading/confusing RBAC surface area (see finding #4 for the one case where this actually broke
a workflow).

## Untested / Unknown Areas

- **Sales-service's own automated test coverage for customers is currently not trustworthy.**
  `customer-block-unblock.test.ts` (3/5 fail) and `offline05-customer-idempotency.test.ts` (3/3
  fail) both fail with `expected 401` on every request — root cause: these tests mint their own
  JWTs with `.setIssuer('erp-test')` but never set `process.env.JWT_ISSUER`, and
  `packages/platform-sdk/src/auth.ts`'s `verifyAccessToken()` now defaults to requiring issuer
  `'erp-auth-service'` (an issuer-verification check the code comments there describe as a
  recently-added "defense-in-depth" hardening). This is **not specific to customers** —
  `permission-guards.test.ts` in the same service fails 19/40 tests with the identical symptom,
  so this is a wider sales-service (and likely cross-service, given 41 files repo-wide use the
  same `setIssuer(...)` pattern) test-infrastructure regression, not a customer-module-specific
  bug. Flagging because it directly means the block/unblock and OFFLINE-05 idempotency behaviors
  requested in this audit's scope have **zero working automated regression coverage right now**,
  even though I was able to verify the underlying block/unblock behavior manually via the live
  API.
- Did not verify branch scoping's absence end-to-end with a real restricted user (no such
  credential exists in `TEST_CREDENTIALS.md`) — code-level finding only (#8 above).
- Did not verify delete-with-outstanding-balance or merge-with-real-transactions end-to-end
  against a customer with real invoice/payment history, to avoid disturbing shared dev-tenant
  data other QA sessions may depend on (memory: "Concurrent sessions on same repo"). Relied on
  the explicit `// TODO Phase 5` code markers instead.
- Did not test cross-tenant isolation with a second live tenant (tenant 1 no longer exists per
  `TEST_CREDENTIALS.md`, and provisioning a fresh tenant was out of scope for an audit-only pass);
  relied on code inspection confirming every query is scoped by `eq(customers.tenantId, tenantId)`
  from the JWT.
- Did not exercise `customFields`/`tags` or the granular communication-preferences
  (`customer_communication_preferences`) matrix beyond confirming the routes exist and are
  permission-gated; out of the audit's explicit scope.
- GSTIN/PAN "encryption" is a plaintext + SHA-256 hash-for-search scheme
  (`customer.routes.ts` line 99-102, comment: "in prod use ctx.encryption.searchHash()" —
  acknowledged as a simplification in the code itself), not evaluated further as a security
  finding since it's explicitly flagged as provisional by the code's own author.

## Readiness Score: 62/100

Justification: the transactional core (create/edit/delete, validation, optimistic locking, RBAC,
tenant isolation, credit-limit _enforcement logic_, blocked-customer invoicing guard, global
search indexing) is genuinely solid and all live-verified working. But this module loses a lot of
points for: a Critical finding that makes a real financial control (credit limits) practically
unusable end-to-end from the actual app; a High-severity search feature that's advertised in the
UI copy but doesn't work at all (GSTIN); a High-severity RBAC bug that dead-ends a named,
seeded role's core workflow; a data-integrity landmine in the update path (#3); a whole address
type with no UI (#5); fake client-side-only sorting on top of a missing `ORDER BY` (#6); no
GSTIN dedup (#7); missing branch scoping on the one module that should have it alongside
Invoices/POS/CRM (#8); and a test suite that currently can't catch regressions in this exact area
because of an unrelated JWT-issuer break. None of these are "customer creation is broken"-tier
outages — the module is usable today — but there are too many concrete, evidenced gaps for this
to be called production-ready without a fix pass, particularly #1 (credit limit) and #2/#3/#4
which are all one-line-of-evidence-away-from-a-support-ticket bugs.
