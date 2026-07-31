# Sales Module (Order-to-Cash) — Fresh Production-Readiness Audit

**Date:** 2026-07-25
**Scope:** `apps/sales-service` (quotations, invoices, delivery challans, payments, sale returns) + `apps/web-frontend/src/pages/sales`
**Method:** Live end-to-end walkthrough against the running stack (gateway :3000, sales-service :3013, accounting-service :3019, gst-service :3018, inventory-service :3012, search-service :3017), plus source-code reading and the sales-service automated test suite. Tenant 2 "QA E2E Test Co". No prior audit claim was trusted without re-verification.

---

## Summary

The core Order-to-Cash money path — Quotation → Delivery Challan → Invoice → Payment → Sale Return — **works correctly end-to-end when driven through the right sequence of API calls**, and every downstream financial effect I checked (accounting journals, GST ledger, inventory stock deduction, search indexing, RBAC, input validation) was live-verified against real data with correct amounts. The two specific historical fixes named in the task (`d9d657e` sale-return accounting/GST, `dc9651d` hardcoded Maharashtra GST state) are both genuinely fixed and confirmed live with real non-zero postings.

However, I found one **critical UX-level dead end**: the primary "Convert to Invoice" button on the Quotation detail page permanently breaks a quotation's ability to ever become an invoice, live-reproduced. I also found a **critical, precisely-rooted bug in the real-time search-indexing pipeline** that silently drops/overwrites invoice and quotation search documents (not sales-service-specific in root cause, but directly affects Sales' searchability). Sales-service's own test suite is currently significantly broken (35/292 tests failing) due to an uncommitted, in-progress security fix elsewhere in the monorepo — a test-infrastructure problem, not a runtime one (I confirmed the underlying behavior it tests for is correct live).

## What Works (live-verified with evidence)

All of the following were exercised live against tenant 2 and can be inspected by ID.

1. **Customer creation** — created customer 912 "AuditQA MH Customer" (Maharashtra billing address, stateCode 27) and 913 "AuditQA KA Customer" (Karnataka, stateCode 29) via `POST /api/sales/customers`, both succeeded with proper `billingAddress.stateCode` persisted.

2. **Quotation → accept → invoice chain** — Quotation 44 (`QT-2-1784925310373`) created for customer 912, sent, accepted, then invoiced directly (skipping the broken standalone "convert" step — see Bug #1). Correct GST computed: subtotal 5000, CGST 125, SGST 125 (intrastate, MH↔MH).

3. **Delivery Challan → dispatch → invoice link** — Challan 1 (`DC-2-1784925169244`) created, dispatched, and linked via `deliveryChallanId` on invoice creation; `DeliveryChallanService` correctly flips challan status to `CONVERTED` and stamps `convertedInvoiceId` inside the same invoice-creation transaction.

4. **Invoice creation + confirm** — Invoice 123 (`INV/26-27/00001`) created in `DRAFT`, confirmed via `POST /invoices/123/confirm`. Stock was deducted only on confirm, not on create (correct design — matches the reservation-then-commit pattern).

5. **GST split correctness (the `dc9651d` fix, live-verified)**:
   - Intrastate (seller MH '27' ↔ customer MH '27'): Invoice 123 → CGST 125.00 + SGST 125.00, IGST 0.00. Correct.
   - Interstate (seller MH '27' ↔ customer KA '29'): Invoice 124 (`INV/26-27/00002`) → IGST 100.00, CGST/SGST 0.00. Correct.
   - Confirmed the frontend (`InvoiceFormPage.tsx`, `QuotationFormPage.tsx`) now fetches `organizationApi.get().gstin` and derives `sellerState` from its first two digits, replacing the old hardcoded `'27'` literal (code-verified: `dc9651d`). Tenant 2's real GSTIN (`27AABCU9603R1ZM`) happens to also be Maharashtra, so this specific fact couldn't be distinguished live by seller-state alone — I instead proved the split logic itself is correct by varying the **customer's** state (intrastate vs interstate above), which exercises the identical `sellerStateCode === placeOfSupply` comparison in `GSTCalculator.computeLine()`.
   - **Caveat (not a live bug, data hygiene note):** the GST register (`GET /gst/register`) still contains ~20 pre-`dc9651d` entries from 2026-07-12 with `isInterstate: true` despite carrying CGST/SGST amounts (self-contradictory) — stale data from before the fix landed. Newly created entries (invoice 123/124, credit note 11) are all correctly flagged. If these tenants ever file a real GSTR-1/3B for that period, this stale data needs a backfill — flagging for awareness, not re-litigating as a new bug.

6. **Inventory stock deduction** — `item 1 @ warehouse 12` was `79.000` available before invoice 123's confirm, `74.000` after (5 units correctly deducted). Verified via `GET /api/inventory/inventory/stock?warehouseId=12`.

7. **Accounting journals — invoice** — Journal `01KYAXFJ6FGJJCY5VVWH1KRFDD` (revenue): Dr Trade Debtors 5250.00 = Cr Sales Revenue 5000.00 + Cr CGST Payable 125.00 + Cr SGST Payable 125.00. Balanced. Journal `01KYAXFJADFPAH64DXY6YMY4QW` (COGS): Dr COGS 937.35 = Cr Inventory 937.35 (5 units × ₹187.47 WACC). Balanced and arithmetically correct.

8. **Payment recording + invoice status machine** — Payment 102 (₹2000, NEFT) allocated to invoice 123 → invoice flipped `DRAFT`-confirmed status `CONFIRMED` → **`PARTIALLY_PAID`** (`paidAmount: 2000.00`, `balanceDue: 3250.00`). Payment 103 (₹3250) allocated → invoice correctly reached **`PAID`** (`paidAmount: 5250.00`, `balanceDue: 0.00`). The unpaid→partial→paid state machine works correctly.

9. **Sale return — the `d9d657e` fix, live-verified**: created Sale Return 11 (`RTN-2-1784925594883`) against invoice 123, returning 2 of the 5 units, with **real line-item selection** (`invoiceLineId: 75` sourced from the actual invoice, not a hardcoded/empty line — confirming the 2026-07-13 rebuild is still intact). Return correctly computed subtotal 2000.00, CGST 50.00, SGST 50.00 (proportional to the original line).
   - **Accounting**: Journal `01KYAXP9NVKXY6J9KMS6YZBZ1J` posted with real non-zero, correctly-signed amounts: Dr Sales Returns 2000.00, Dr CGST Payable 50.00, Dr SGST Payable 50.00 = Cr Trade Debtors 2100.00. This directly confirms `d9d657e` fixed the ₹0-journal bug.
   - **GST ledger**: a `CREDIT_NOTE` entry (id 80, `sourceDocumentType: SALE_RETURN`, `sourceDocumentId: 11`) is now reachable via `GET /gst/register`, with taxableAmount 2000.00 and totalGst 100.00 — confirming the GST-ledger reachability half of `d9d657e` as well.

10. **Search indexing** — invoices and quotations do reach Elasticsearch and are findable via `GET /api/search/search?q=...&entity=invoice`. (See Bug #2 for a serious caveat on the real-time indexing path's correctness.)

11. **RBAC** — `SALES_MANAGER` successfully performed every step above. `HR_MANAGER` (a role with zero sales permissions) got a clean `403 FORBIDDEN` (`Missing permission: INVOICE_CREATE` / `INVOICE_VIEW`) on both invoice creation and invoice listing — not a silent failure, not a 500, not a 401.

12. **Validation** — `POST /invoices` with negative quantity → `400 VALIDATION_ERROR` (Zod: "Number must be greater than 0"); missing `customerId` → `400` ("Required"); empty `lines: []` → `400` ("Array must contain at least 1 element"). All clean 400s, no 500s.

13. **Pagination/filtering** — `GET /invoices?page=1&pageSize=2`, `?status=PAID`, `?customerId=912` all returned correctly scoped/paginated results. List ordering uses `ORDER BY invoiceDate DESC, id DESC` (a fixed tiebreaker, matching the pagination-tiebreaker fix pattern from earlier audits) — there's no user-controlled `sort` param on this endpoint, which is a design choice, not a bug.

14. **No hardcoded branchId** — grepped `apps/web-frontend/src/pages/sales/*.tsx` for `branchId: 1` / `branchId:1` literals: none found. All forms derive `branchId` from a controlled `<select>` bound to the branch list, or from the source quotation/challan/invoice being converted. One minor exception, see Finding #5.

## Bugs / Gaps Found

### 1. CRITICAL — "Convert to Invoice" button on Quotation detail page is a permanent dead end

**Live-reproduced.** `QuotationDetailPage.tsx` shows two buttons on an `ACCEPTED` quotation: a primary **"Convert to Invoice"** button (calls `POST /quotations/:id/convert`) and a secondary **"Create Invoice"** button (navigates straight to the invoice form). The primary button's own confirm-dialog copy says _"This will mark the quotation as CONVERTED. You can then create an invoice linked to this quotation."_

That is false. `POST /quotations/:id/convert` (`QuotationService.convert()`) flips the quotation's status straight to `CONVERTED` and does **nothing else** — no invoice is created, `convertedInvoiceId` stays `null`. But the actual invoice-creation path (`InvoiceService.create()`, `apps/sales-service/src/domain/InvoiceService.ts:365-384`) requires the referenced quotation to still be in status **`ACCEPTED`**:

```
if (!updatedQuotation) {
  throw new BusinessError('INVALID_QUOTATION_STATUS',
    `Quotation ${params.quotationId} must be ACCEPTED to convert to an invoice`);
}
```

So once a user clicks the primary "Convert to Invoice" button, the quotation is permanently stuck: it can never reach `ACCEPTED` again (no such transition exists), and it can never be linked to a real invoice again (`convertedInvoiceId` is null forever, and the quotation itself is unusable as an invoice source).

**Live evidence:** Quotation 43 (`QT-2-1784925097606`) — called `POST /quotations/43/convert` → `{"data":{"quotationId":43}}` success, status became `CONVERTED`. Immediately after, `POST /invoices` with `quotationId: 43` → `400 {"error":{"code":"INVALID_QUOTATION_STATUS","message":"Quotation 43 must be ACCEPTED to convert to an invoice"}}`. The quotation is now a dead record. (I worked around this for the rest of the audit by using a second quotation, 44, and skipping the "Convert" button — going straight to invoice creation instead, which correctly auto-transitions the quotation to `CONVERTED` with the invoice properly linked.)

**Business impact:** Any real user who clicks the primary, most-prominent CTA on an accepted quotation loses that quotation permanently — they must start over with a brand-new quotation or a manually-built invoice with no audit trail back to the original quote. This is very likely to be hit in normal use since it's the default/primary button.

**Fix direction:** either make the "Convert to Invoice" button navigate straight to the invoice form (like "Create Invoice" already does) without calling `/convert` first, or have `/convert` accept and pass through to invoice creation atomically, or remove the standalone `/convert` endpoint/button entirely since `InvoiceService.create()` already performs the real conversion.

Files: `apps/web-frontend/src/pages/sales/QuotationDetailPage.tsx:101-108,188-206`, `apps/sales-service/src/domain/QuotationService.ts:189-227`, `apps/sales-service/src/domain/InvoiceService.ts:365-384`.

### 2. CRITICAL (root cause outside sales-service, effect confirmed inside it) — Real-time search indexing silently overwrites invoices/quotations under ES document id "0"

**Live-reproduced against the real Elasticsearch cluster.** Querying `erp_2_invoice` directly (`GET localhost:9200/erp_2_invoice/_search`) shows a document with `_id: "0"` whose body contains `invoiceId: 124` — i.e. invoice 124's real-time-indexed data landed on ES document id literal `"0"`, not `"124"`. The same pattern reproduces for quotations (`erp_2_quotation`, doc `_id: "0"` containing `quotationId: 44`). Because every invoice/quotation confirmed via this event-driven path writes to the **same** doc id `"0"`, each new invoice/quotation silently overwrites the previous one's live-indexed copy — invoice 123's real-time doc no longer exists at all (clobbered by invoice 124's confirm 2 minutes later). A separate, correctly-ID'd copy of both invoices does also exist (ids `"123"`/`"124"`) but only because a full batch resync ran during the audit — that path is not real-time.

**Root cause, precisely located:** `packages/platform-sdk/src/events.ts:141`:

```
aggregateId: Number(businessPayload['id'] ?? 0) || 0,
```

`PlatformEventConsumer` (the shared, generic Kafka-consumer wrapper used by search-service and others) reconstructs `event.aggregateId` generically by reading `businessPayload['id']`. But sales-service's `INVOICE_CONFIRMED` outbox payload uses the field name `invoiceId`, not `id` (`InvoiceService.ts:677`), and `QUOTATION_CONVERTED`'s payload uses `quotationId`, not `id` (`QuotationService.ts:219`). Neither payload has a literal `id` field, so `businessPayload['id']` is always `undefined`, and `aggregateId` silently defaults to `0` for every one of these events. `search-service`'s `SearchSyncConsumer.ts:19` then computes the ES document id as `` `${idPrefix ?? ''}${event.aggregateId}` `` = `"0"` for every invoice/quotation confirmed this way.

**Business impact:** at any point in time, real-time/event-driven search only reflects the single most-recently-confirmed invoice and the single most-recently-converted quotation per tenant; every other invoice/quotation is invisible to search until the next full periodic resync job runs (frequency not verified in this audit — if it's daily, sales staff searching for "yesterday's invoice" by number will frequently get zero results). This is the same general bug class as the "stock entity had zero indexing path ever" finding from the 2026-07-23 search-service audit, but distinct — this is a live, previously-undetected variant.

**Scope note:** the root cause lives in shared `packages/platform-sdk`, not in sales-service itself, so it may also silently affect any other event type across the platform whose outbox payload doesn't use a literal `id` field — that's outside this audit's scope to fully enumerate, but worth a platform-wide follow-up grep for `businessPayload['id']` consumers vs. actual outbox payload shapes.

Files: `packages/platform-sdk/src/events.ts:141`, `apps/search-service/src/consumers/SearchSyncConsumer.ts:17-19`, `apps/sales-service/src/domain/InvoiceService.ts:670-694`, `apps/sales-service/src/domain/QuotationService.ts:189-227`.

### 3. HIGH — sales-service test suite is currently broken: 35/292 tests fail (10/31 files), all traced to one root cause

Ran `pnpm --filter @erp/sales-service test`: **35 failed, 152 passed, 105 skipped** (292 total). Every failure is the identical assertion pattern — a test expecting `403 Forbidden` instead receives `401 Unauthorized`. Isolated one test (`permission-guards.test.ts`, run alone via `-t` filter, single-file run, not a parallel-run artifact) and confirmed the root cause precisely:

`packages/platform-sdk/src/auth.ts:31-32` (an **uncommitted, in-progress** change — `git status` shows this file modified, not yet committed) recently added issuer validation to `verifyAccessToken()`:

```
const issuer = process.env['JWT_ISSUER'] ?? 'erp-auth-service';
const { payload } = await jwtVerify(token, publicKey, { algorithms: ['RS256'], issuer });
```

This is a good defense-in-depth fix (its own inline comment explains why). But 10 of sales-service's test files self-sign RS256 test JWTs with `.setIssuer('erp-test')` (a distinct issuer from the real `'erp-auth-service'` default) and **never set `process.env['JWT_ISSUER']`** to match. `jwtVerify` now rejects every one of these tokens with an issuer-mismatch error, which `authenticate()` catches and turns into a blanket `401`, for every single request in these test files — before the code under test (permission checks, idempotency logic, branch isolation) ever runs.

Tests asserting the strict `expect(res.statusCode).toBe(403)` fail loudly (this is the visible 35). Tests asserting the weaker `expect(res.statusCode).not.toBe(403)` — used for the "should succeed" half of the same guard tests — **silently pass anyway**, because 401 also satisfies "not 403". So this bug doesn't just fail 35 tests; it means the ~20+ "does not return 403" companion tests in the same files are currently providing **zero real coverage** while reporting green.

Affected files (all fail with this pattern): `crm-campaign-permission-guards.test.ts`, `customer-block-unblock.test.ts`, `offline02-pos-sale-idempotency.test.ts`, `offline05-customer-idempotency.test.ts`, `offline07-stock-conflict.test.ts`, `payment-view-permission-guard.test.ts`, `permission-guards.test.ts`, `pos-branch-isolation.test.ts`, `quotation-sale-return-permission-guards.test.ts`, `sync-routes.test.ts`.

**This is not a production bug** — I independently confirmed live against the real running stack that RBAC/permission enforcement genuinely works correctly (HR_MANAGER correctly 403'd, SALES_MANAGER correctly succeeded — see "What Works" #11). It's a test-infrastructure regression caused by a legitimate, still-in-progress security hardening change whose test fixtures weren't updated to match. Given the shared `platform-sdk` location of the fix, this likely also breaks any other service's test suite using the same self-signed-test-JWT-with-custom-issuer pattern — out of this audit's scope to confirm further, but worth a platform-wide sweep before this change is committed.

Files: `packages/platform-sdk/src/auth.ts:22-42` (uncommitted), and the 10 test files listed above.

### 4. MEDIUM — sellerStateCode/placeOfSupply are fully client-supplied and not validated against the tenant's actual registered state server-side

`dc9651d` fixed the frontend to correctly _derive_ `sellerStateCode` from the tenant's real GSTIN instead of hardcoding `'27'`. But `sales-service`'s `POST /invoices` and `POST /quotations` schemas (`invoice.routes.ts:44-45`, `quotation.routes.ts:30-31`) accept `placeOfSupply`/`sellerStateCode` as plain client-supplied strings (`z.string().length(2)`) with no server-side cross-check against the organization's actual GSTIN/state (`GSTCalculator.computeLine()` just trusts whatever it's given). A malicious or buggy client (or a future POS/mobile client that reintroduces a hardcoded value, exactly like the bug `dc9651d` just fixed once) could submit any 2-digit state code and get an incorrect CGST/SGST-vs-IGST split with no backend guard. Not exploited/reproduced as a live bug in this audit (the current frontend behaves correctly), but it's the same trust-boundary gap that caused the original bug, just not yet closed at the source of truth.

Files: `apps/sales-service/src/api/invoice.routes.ts:44-45`, `apps/sales-service/src/api/quotation.routes.ts:30-31`, `apps/sales-service/src/domain/GSTCalculator.ts`.

### 5. LOW — PaymentFormPage.tsx has a residual `?? 1` branchId fallback

`apps/web-frontend/src/pages/sales/PaymentFormPage.tsx:23`:

```
const branchId = currentBranchId ?? user?.branchIds?.[0] ?? 1;
```

Not the same class of bug as the previously-fixed app-wide hardcode sweep (this only activates when both the branch-store selection AND the user's own assigned branches are empty), but real roles in this tenant do have `branchIds: []` in their JWT (e.g. `OWNER`, `SALES_MANAGER` — confirmed from the live login response), so for those roles, if no branch is ever selected in the branch-switcher UI, new payments would silently default to branch 1 regardless of actual context. Low severity since it requires the branch-store to be unset, but worth tightening (e.g. surfacing a required branch picker instead of a silent fallback), matching the standard already applied elsewhere in these same forms (Invoice/Quotation/Challan all use a controlled `<select>` with no numeric fallback).

## Untested / Unknown Areas

- **Event-service outbox/event-store direct inspection** for `INVOICE_CONFIRMED`/`SALE_RETURN_APPROVED` was attempted but hit a 429 rate limit before I could complete it; I did not retry further given time budget. I consider this indirectly confirmed instead — the downstream Kafka consumers for accounting (journals posted), GST (ledger entries created), and search (documents indexed, albeit with Bug #2) all fired correctly off these same events, which wouldn't be possible if the events weren't published.
- **Credit note apply/refund** (`POST /credit-notes/:id/apply`, `/refund`) — not exercised live; only creation via sale return was tested.
- **Quotation reject/expire paths** and **invoice cancel/duplicate** — not exercised live.
- **POS-originated sales** (`pos.routes.ts`) — explicitly out of scope per the task (POS frontend audited separately), not re-tested here.
- **Full-batch search resync job's actual schedule/frequency** — not located/verified; relevant to how long Bug #2's staleness window really is in practice.
- **CRM/Customer module internals** — correctly out of scope; only confirmed Sales creates invoices against a real customer record (customers 912/913).

## Readiness Score: 68/100

**Justification:** The financial core is solid — every money-moving step I traced (GST computation, journal posting, GST-ledger entries, stock deduction, payment-status state machine, sale-return accounting) produced correct, balanced, live-verified numbers, and both of the two specific historical bugs named in the task brief are genuinely fixed. RBAC and input validation are clean. That's a strong foundation.

But this is pulled down substantially by two critical, live-reproduced issues that a real user or real report would hit immediately in normal operation: the primary "Convert to Invoice" button is a data-loss trap on the single most common quotation-acceptance workflow, and the real-time search index is silently lossy for the module's two most-searched entity types (invoices, quotations) — most invoices in the system are effectively invisible to search between resync runs. On top of that, the service's own test suite is currently unable to verify a meaningful fraction of its permission/idempotency guarantees due to an in-flight, uncommitted change elsewhere in the monorepo, so regressions in that surface area wouldn't currently be caught by CI even though the live behavior itself checks out today.

None of this is a "rebuild the module" situation — both criticals have narrow, well-understood fixes — but neither is safe to ship past without fixing first.
