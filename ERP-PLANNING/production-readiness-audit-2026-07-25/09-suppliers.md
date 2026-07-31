# Suppliers Module — Production Readiness Audit (2026-07-25)

Scope: supplier master-data CRUD (apps/sales-service/src/api/supplier.routes.ts — not
purchase-service, see Architecture Note below), supplier addresses/GST/credit terms,
supplier contacts, and supplier payment recording / AP lifecycle
(apps/purchase-service/src/domain/SupplierPaymentService.ts +
apps/purchase-service/src/api/supplier-payment.routes.ts), plus the accounting-service
consumer that should post supplier payments to the general ledger
(apps/accounting-service/src/consumers/PaymentAccountingConsumer.ts →
handleSupplierPaymentMade). All testing done live against tenant 2 ("QA E2E Test Co") via
the gateway (http://localhost:3000) and direct Postgres inspection
(erp-postgres-primary, db `erp`). Environment was already running; nothing was restarted.

## Summary

Supplier CRUD, validation, search, RBAC-deny paths, and the AP subledger (supplier
balance projection inside purchase-service) all work correctly and were verified live.
**The critical question this audit was launched to answer — whether Supplier Payment
posting hits the same silent GL-posting bug found in the Purchase module (GRN/Purchase
Return) — is CONFIRMED YES.** Recording and allocating a real supplier payment
(₹21,000 against GRN-AUDIT-33) succeeded completely on the purchase-service side (payment
created, allocated, supplier balance projection updated) but produced **zero** general
ledger journal entries in accounting-service, with no error surfaced anywhere a normal
user or admin would see it. Root cause confirmed at the source-code and database level:
`PostingMatrixService.DEFAULT_POSTING_RULES.SUPPLIER_PAYMENT_MADE` hardcodes
`debitCode: '2010'` (Accounts Payable), but tenant 2's real seeded chart of accounts has
no account with code `2010` — the real AP account is `2100` ("Accounts Payable
(Creditors)"). This is the identical defect class the Purchase-module audit found for
GRN_APPROVED/PURCHASE_RETURN_APPROVED (which use the same hardcoded `'2010'`), now
independently confirmed on the payment side too. Every module event that credits/debits
Accounts Payable — GRN receipt, purchase return, supplier payment, and (per the
inherited code) EXPENSE_APPROVED/EXPENSE_PAID — is affected, because they all reference
the same wrong hardcoded code.

A second, independent, real bug was also found and live-verified: the RBAC gap-fixes
documented in `apps/tenant-service/src/rbac/role-defaults.ts` (comments dated "Purchase
audit 2026-07-21") were never applied to the already-provisioned tenant-2 roles in the
database — `role-defaults.ts` is only a seed template consulted at tenant-creation time,
and there is no migration/backfill mechanism that re-syncs it into existing tenants'
`role_permissions` rows. Concretely: **PURCHASE_MANAGER — the role that owns supplier
management — cannot view a supplier's statement/ledger in the live system today**,
despite the source code explicitly granting it that permission.

Readiness: **35/100** — see justification at the bottom.

## What works (verified live)

- **Supplier create** — `POST /api/sales/suppliers` (routed to sales-service, not
  purchase-service — see Architecture Note). Created supplier id **13** ("AUDIT Test
  Supplier Pvt Ltd") with full detail: GSTIN `27AAACT2727Q1ZV`, PAN, billing address,
  bank name/IFSC/account number, credit days/limit, opening balance, notes. All fields
  persisted correctly on GET.
- **Supplier edit** — `PUT /api/sales/suppliers/13` with optimistic-lock `version`
  correctly increments `version` (0→1→2→3 across 3 edits) and updates fields (credit
  days 30→45→60, credit limit 500000→750000).
- **GSTIN format validation** — `POST` with `gstin: "INVALID123"` → clean
  `422 VALIDATION_ERROR` "Invalid GSTIN format", not a 500.
- **Required-field validation** — omitting `phone` → clean `VALIDATION_ERROR` "Required".
- **Search** — `GET /api/sales/suppliers?search=AUDIT` correctly matched supplier 13 by
  `displayName` (also matches phone/GSTIN per the route's `ilike` `or()`).
- **Status filter** — `GET /api/sales/suppliers?status=ACTIVE` works.
- **404 handling** — `GET /api/sales/suppliers/999999` → clean `404 NOT_FOUND`, not a
  500 or empty-200.
- **RBAC deny paths** — logged in as CASHIER (no SUPPLIER_* / PAYMENT_OUT_* grants):
  `GET /suppliers` → `403 Missing permission: SUPPLIER_VIEW`; `POST /suppliers` → `403
Missing permission: SUPPLIER_CREATE`; `POST /supplier-payments` → `403 Missing
permission: PAYMENT_OUT_CREATE`. All clean 403s, not 500s or silent empty results.
- **Supplier Payment creation** — `POST /api/purchase/supplier-payments` created payment
  id **26** (`SPY-2-1784930795298`, ₹21,000, NEFT) against supplier 2 ("Global Textiles
  Supplier"), correctly transactional (payment row + `projectionSupplierBalance` update +
  outbox event all in one DB transaction, per the code comment referencing a prior
  three-statement-race fix).
- **Supplier Payment allocation** — `POST /supplier-payments/26/allocate` against GRN 33
  (₹21,000, the exact GRN-AUDIT-33 amount from the Purchase-module audit) correctly
  moved payment 26 to `FULLY_ALLOCATED`, `allocatedAmount: 21000.00`,
  `unallocatedAmount: 0.00`. Over-allocation guard (`WHERE unallocatedAmount >=
totalToAllocate`) is a real atomic DB-level guard, not a JS-side race.
- **Supplier balance projection (AP subledger, purchase-service side)** — correctly
  updated: `projection_supplier_balance` for supplier 2 shows `total_paid` incremented
  by 21000 and `current_balance` decremented by 21000 in the same transaction as the
  payment insert. This is accurate and consistent — the bug is downstream of this, in
  accounting-service.
- **Outbox reliability** — the `SUPPLIER_PAYMENT_MADE` outbox event for payment 26
  (`event_id 01KYB2MZSB2SJ4NWMV3FRZ3M11`) was correctly written and marked
  `published = true` at 22:06:35.329Z, ~30ms after creation. The outbox/publish path
  itself is not the bug.
- **Purchase-service backend tests** — `pnpm --filter @erp/purchase-service test --
purchase-workflow.test.ts`: 18/18 passed (unit-level, mocked DB — would not catch the
  chart-of-accounts mismatch, which is a live-data/config issue, not a logic issue).
- **Frontend test** — `pnpm --filter @erp/web-frontend test -- SuppliersPage.test.tsx`:
  2/2 passed.

## Bugs / gaps found

### 1. CRITICAL — Supplier Payment posts zero journal entries to the GL; same root cause as GRN/Purchase Return bug, now independently confirmed

**Evidence chain (all live, tenant 2):**

1. Created supplier payment 26 (₹21,000) and allocated it to GRN 33 — both succeeded.
2. `GET /api/accounting/journals?referenceType=SUPPLIER_PAYMENT&referenceId=26` →
   `{"content": [], "totalElements": 0}`. Zero journals.
3. Postgres `outbox_events`: the `SUPPLIER_PAYMENT_MADE` event (id
   `01KYB2MZSB2SJ4NWMV3FRZ3M11`) was published (`published = t`).
4. Postgres `inbox_events`: only `search-service` has a `PROCESSED` row for that
   `event_id`. **There is no row at all for `consumer_service = 'accounting-service'`**
   — compare against 10 recent, genuinely `PROCESSED` accounting-service inbox rows for
   other event types, proving the consumer is alive and normally works.
5. Postgres `dlq_items`: 0 rows total. No dead-letter record exists anywhere.
6. Source-code trace confirms why: `PostingMatrixService.DEFAULT_POSTING_RULES
.SUPPLIER_PAYMENT_MADE = [{ debitCode: '2010', creditCode: '1010', ... }]`
   (apps/accounting-service/src/domain/PostingMatrixService.ts:29-35). In
   `buildJournalEntry`, account codes are looked up from the real `accounts` table; if
   either side of a rule isn't found the line pair is silently skipped
   (`if (!drId || !crId) continue; // skip unconfigured accounts gracefully`, line 226).
   `codeToId.get('2010')` returns `undefined` — confirmed directly:
   `SELECT account_code, name FROM accounts WHERE tenant_id=2 AND account_code IN
('2010','2100')` returns only `2100 | Accounts Payable (Creditors)`; `1010 | Cash in
Hand` does exist. With the debit side unresolved, `lines` ends up empty, and
   `if (lines.length < 2) throw new BusinessError('JOURNAL_INSUFFICIENT_LINES', ...)`
   fires (line 311-313).
7. That throw happens inside the same DB transaction as the Kafka inbox-claim (per the
   architecture already documented by the Purchase-module audit), so the transaction
   rolls back completely — erasing the inbox row, the attempted journal, and any trace
   that accounting-service ever touched this event. This is why step 4 shows no
   accounting-service inbox row instead of a `FAILED` one.
8. `posting_matrix` (tenant-specific override table) has 0 rows for tenant 2 — nothing
   overrides the broken default.

**Business impact:** Every rupee paid to a supplier is completely invisible to the
general ledger — cash/bank goes out in reality but the GL's Cash and Accounts Payable
balances never move. Combined with the sibling Purchase-module finding (GRN receipts and
purchase returns also never post), the entire Accounts Payable side of the books is
non-functional: nothing debits AP, nothing credits AP, nothing reduces Cash for a
payment. Trial Balance, Balance Sheet, and Cash Flow are all silently wrong for any
tenant with real purchase activity. Since it fails identically for GRN_APPROVED,
PURCHASE_RETURN_APPROVED, EXPENSE_APPROVED, and EXPENSE_PAID (all reference the same
`'2010'` in the same file), this is one fix (change `'2010'` → `'2100'` in six places in
`DEFAULT_POSTING_RULES`, or seed an account with code `2010`) that resolves the entire
family of bugs across Purchase and Suppliers.

**Severity: Critical.** Confirmed exactly as "likely but not independently tested" per
the brief — now independently, live-verified true for the payment side.

### 2. HIGH — PURCHASE_MANAGER (and ACCOUNTANT) cannot view Supplier Statement/Ledger live, despite source code granting the permission

`GET /api/purchase/suppliers/2/statement` and `/outstanding` as
`purchase.manager@qa-e2e.local` → `403 {"code":"FORBIDDEN","message":"Missing
permission: SUPPLIER_STATEMENT_VIEW"}`. But
`apps/tenant-service/src/rbac/role-defaults.ts` (line 150) explicitly grants
`PERMISSIONS.SUPPLIER_STATEMENT_VIEW` to `PURCHASE_MANAGER`, with a comment dated
"Purchase audit 2026-07-21" describing this exact gap as already fixed. Direct DB query
confirms the live tenant's role doesn't have it:
`SELECT permission FROM role_permissions WHERE role_id=6 (PURCHASE_MANAGER, tenant 2)
AND permission LIKE 'SUPPLIER%'` → only `SUPPLIER_CREATE, SUPPLIER_EDIT, SUPPLIER_VIEW`
(3 rows) — `SUPPLIER_STATEMENT_VIEW` is absent, along with every other "Purchase audit
2026-07-21 gap-fix" permission in that role-defaults.ts block (REQUISITION__, RFQ__,
SUPPLIER_QUOTATION__, PURCHASE_INVOICE__, CREDIT_LIMIT_OVERRIDE, EXPENSE_*): the role
only has 27 permissions total in the DB. `role_permissions` for
`SUPPLIER_STATEMENT_VIEW` in tenant 2 exists only for OWNER/ADMIN/SUPER_ADMIN.

**Root cause:** `role-defaults.ts` is a seed template applied only at tenant-provisioning
time; there is no migration/backfill step that re-applies later changes to already-
provisioned tenants' `role_permissions` rows. This means every RBAC fix landed in
`role-defaults.ts` across the many prior QA sessions referenced in project memory is
**still not live** for tenant 2 (and presumably any other already-provisioned tenant)
unless someone manually re-ran a seed/reset script after each fix. This is a systemic
gap, not specific to suppliers, but it was directly reproduced here on an
audit-in-scope permission (item 8 — supplier ledger/statement view).

**Business impact:** The role that owns supplier/purchasing operations in practice
cannot see what it owes each supplier without escalating to OWNER/ADMIN — a real
day-to-day blocker, and evidence that "fixed in role-defaults.ts" claims in prior QA
completion docs should not be trusted as "fixed in any live/persisted tenant" without a
DB check.

### 3. MEDIUM — `getOutstanding()` lists ALL approved GRNs forever, never excludes fully-paid ones

`SupplierPaymentService.getOutstanding()` (apps/purchase-service/src/domain/
SupplierPaymentService.ts:240-252) queries `grns` where `status = 'APPROVED'` with no
join against `supplierPaymentAllocations` and no filter on payment status. Live proof:
after payment 26 fully allocated ₹21,000 against GRN 33 (making it fully paid), `GET
/suppliers/2/outstanding` still lists GRN 33 (`grandTotal: 21000.00`) in the outstanding
bills array, indistinguishable from genuinely-unpaid GRNs. The same is true of every
other GRN ever approved for supplier 2 (18 GRNs, ~₹700K) — the "outstanding" endpoint is
really just "all approved GRNs, ever," not an accurate open-items list.

**Business impact:** Anyone using this list to decide what to pay next (its evident
purpose) sees stale, already-settled bills mixed in with real ones, with no way to tell
them apart from the response alone.

### 4. MEDIUM — Duplicate supplier detection is entirely absent

`POST /suppliers` with a GSTIN identical to an existing supplier's succeeds silently — no
uniqueness constraint at the DB or application level. Live proof: supplier 14
("Duplicate GSTIN Test Supplier") was created with `gstin: "27AAACT2727Q1ZV"`, identical
to supplier 13's GSTIN, with `201 Created` and no warning. There's also no duplicate-name
check.

**Business impact:** Same vendor can be onboarded multiple times under different
`displayName`s, splitting purchase history/payment history across records and making the
(already-broken, see #3) outstanding/statement views even less trustworthy.

### 5. LOW-MEDIUM — `tags` field is silently wiped on every supplier edit made through the UI

`SupplierFormPage.tsx` never registers a `tags` input (`register('tags')` doesn't
exist), but `SupplierDetailPage.tsx` (lines 450-455) does render tags on the detail page
if present. Because `PUT /suppliers/:id` reuses the create Zod schema
(`SupplierUpdateSchema = SupplierSchema.extend({version...})`) which defaults
`tags: z.array(z.string()).default([])`, any field the client omits from the request
body — including `tags` because the form never collects it — is defaulted back to `[]`
by Zod before the DB write. Live-reproduced: set `tags: ["vip","priority"]` via direct
API call, then PUT again without `tags` (simulating the real UI form, which never sends
it) → tags silently reset to `[]`. Same defaulting mechanism reset `supplierType` and
`isRegistered` to their schema defaults in the same test when omitted — those two happen
to be safe in practice only because the UI form _does_ register and resend them (verified
in `SupplierFormPage.tsx`), so this is specifically a `tags`-only live bug, not a
theoretical one.

**Business impact:** Low — tags appear to be a lightly-used categorization feature with
no other consumer found in the codebase — but any tag set via import, direct API, or a
future feature will be destroyed by the very next ordinary edit through the Suppliers UI.

### 6. LOW — Supplier bank account number stored and returned in plaintext over the API

`GET /suppliers/13` and the create/update responses include `"bankAccountNo":
"123456789012"` in cleartext (`bankAccountNoHash` is stored alongside it but the raw
value is also stored and returned — the route comment says "Bank — encrypted before
storage; simplified here", i.e. it is explicitly _not_ actually encrypted). Not a new
finding for this audit's core question but worth flagging: any client with SUPPLIER_VIEW
can read every supplier's bank account number in plaintext via the API, and it round-
trips through the frontend's `type="password"` field (which only masks the on-screen
display, not the network payload or DB storage).

### 7. Architectural note (not a bug) — Supplier CRUD lives in sales-service, not purchase-service

Despite the module being called "Suppliers" and living conceptually next to Purchase,
the actual create/edit/delete/list/contacts routes are registered in
`apps/sales-service/src/api/supplier.routes.ts`, not `purchase-service`. purchase-service
only owns `supplier-payment.routes.ts` (payments) plus a _second_, unused, stub
implementation of `GET /suppliers/:id/statement` and `/outstanding` inside sales-service
that always returns `transactions: []` / hardcoded values — dead code, correctly never
called by the frontend (`web-frontend/src/api/endpoints.ts` has an explicit comment
routing statement/outstanding calls to `purchase`, not `sales`, specifically because of
this duplication). Flagging only because a future maintainer calling the sales-service
statement endpoint directly (e.g. via a script or Postman) would get plausible-looking
but entirely fake zero-data back with no error.

## Untested / unknown areas

- Supplier `bounceCheque()` flow (cheque-mode payment bounced, GL reversal via
  `handleChequeBounced`) was not live-tested this session — code inspection shows it
  correctly looks for a `referenceType='SUPPLIER_PAYMENT'` original journal before
  reversing, but since the original journal never gets created (bug #1), a bounce on a
  real cheque payment would hit `JOURNAL_NOT_FOUND_FOR_REVERSAL` and throw — not
  independently confirmed live.

- Payment voucher PDF generation (`GET /supplier-payments/:id/voucher`) was not
  exercised — depends on report-service's `/reports/pdf`, out of this audit's scope.
- Branch-scoping enforcement on supplier payments (`assertSupplierPaymentBranchInScope`)
  was read but not live-tested with a user restricted to a different branch than the
  payment.
- `SupplierImportPage.tsx` (bulk supplier import) was not exercised.
- Multi-tenant cross-tenant isolation was not explicitly tested with a second tenant's
  credentials (tenant-scoping is enforced via `eq(suppliers.tenantId, tenantId)` in every
  query read in source, and no cross-tenant leak was observed in any list/get call made,
  but a live two-tenant test was not performed).
- PDC (post-dated cheque) alert flow (`getPdcDueInDays`/`markPdcAlertSent`) not
  exercised.

## Test data created this session (tenant 2)

- Supplier id **13** — "AUDIT Test Supplier Pvt Ltd" (full detail, GSTIN
  `27AAACT2727Q1ZV`, bank details, credit terms).
- Supplier id **14** — "Duplicate GSTIN Test Supplier" (deliberately duplicate GSTIN, to
  prove finding #4).
- Supplier Payment id **26** — `SPY-2-1784930795298`, ₹21,000 NEFT against supplier 2,
  fully allocated to GRN 33 (`GRN-AUDIT-33`, from the prior Purchase-module audit
  session).

## Readiness score: 35/100

Justification: CRUD, validation, and RBAC-deny mechanics for supplier master data are
genuinely solid (would score ~80+ alone). But the module's entire financial purpose —
being the master data and transaction record behind Accounts Payable — is broken at the
most fundamental level: money paid to suppliers never reaches the general ledger, with no
error surfaced to any user, admin, or monitoring system (zero DLQ entries). This is
compounded by the outstanding-balance view being permanently wrong (bug #3) and the role
that's supposed to own this whole area being unable to see supplier statements at all
live (bug #2). A finance team relying on this module today would be paying real suppliers
while the books silently diverge further from reality with every payment, with the
system's own reports giving no indication anything is wrong. Not production-ready until
bug #1 (one-line-per-account-code fix, but touches 6 rules across 2 services worth of
Purchase+Suppliers events) and bug #2 (re-sync or fix the RBAC provisioning gap) are
resolved.
