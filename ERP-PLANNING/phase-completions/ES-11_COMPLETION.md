# ES-11 Completion Report — NIC E-Invoice & E-Way Bill
**Date:** 2026-07-03
**Status:** COMPLETE (adapted to work already in the codebase — see Deviations)

## Summary
This phase's prompt assumed a greenfield build (new `NICClient` in `platform-sdk`, new
`EInvoicePage` STUB banner to remove, new consumers, new schema columns). The actual
codebase already had a substantial NIC integration in place — `EInvoiceService`,
`EwayBillService`, `einvoice_data` table, manual generate/cancel/status/EWB routes, and a
15-minute scheduler retry job — built under an earlier "Phase 7 GST" pass, unrelated to
this ES-11 audit prompt. The STUB banner (added in ES-01) was still present and the whole
flow was **manual-trigger only**: nothing generated an IRN automatically when an invoice
was confirmed, and nothing cancelled it when an invoice was cancelled. The real gap was
closing that loop, plus hardening retry behavior and giving the frontend a real status
view instead of a single-invoice ID lookup. That's what this phase delivers.

## NIC Integration
- NIC Base URL used: SANDBOX (`https://einv-apisandbox.nic.in` for e-Invoice,
  `https://sandboxeinvoice.nic.in/ewaybillapi/v1.03` for EWB — production URLs
  auto-selected when `NODE_ENV=production`, pre-existing behavior, unchanged)
- IRN generation: WORKING (unit-tested; not exercised against the live NIC sandbox — no
  network access to NIC in this environment, see Known Limitations)
- EWB generation: WORKING (pre-existing; unit-tested for the ₹50,000 threshold and
  success-path storage)
- **New**: IRN generation is now auto-triggered by the `INVOICE_CONFIRMED` Kafka event
  for B2B invoices (customer has a GSTIN on file); IRN cancellation is now
  auto-triggered by `INVOICE_CANCELLED` within NIC's 24-hour cancellation window

## STUB Banner
- Removed from EInvoicePage.tsx: **YES**. Replaced with a live "Recent e-Invoices" table
  (status badges, IRN/QR indicator, e-Way Bill column, per-row Retry button) backed by a
  new `GET /gst/einvoice/list` endpoint.

## What Was Built
1. **`buildNicPayload()`** (`EInvoiceService.ts`) — pure function converting an invoice +
   its lines into the NIC `ItemList`/`ValDtls` JSON shape, driving CGST/SGST vs IGST
   selection off `igstAmount > 0` (interstate).
2. **`fetchWithRetry()`** (`domain/nicRetry.ts`) — shared retry helper (3 attempts, 1s/2s
   exponential backoff) for transient failures (network error, HTTP 429/5xx). Wired into
   `EInvoiceService.generateIrn` and `cancelIrn`.
3. **`EInvoiceEventConsumer.ts`** (new) — `handleInvoiceConfirmedForEinvoice` (auto IRN
   generation, B2B only) and `handleInvoiceCancelledForEinvoice` (auto IRN cancellation
   within 24h, else marks `CANCEL_REQUIRED_MANUALLY`). Wired into `main.ts`'s existing
   Kafka dispatcher alongside the pre-existing GST-ledger consumer; failures are caught
   and logged rather than thrown, so a NIC outage never blocks GST-ledger recording for
   the same event.
4. **`EInvoiceService.retrySingle()`** + `POST /gst/einvoice/retry/:invoiceId` — manual
   single-invoice retry re-using the NIC payload stored on the original attempt, backing
   the frontend's "Retry" button.
5. **`GET /gst/einvoice/list`** — tenant-scoped, most-recently-updated-first list of
   invoices with an e-Invoice/e-Way Bill record on file.
6. **`EInvoicePage.tsx`** — STUB banner removed; new list table with IRN status badges,
   truncated IRN + "QR ready" indicator, e-Way Bill column, and a Retry action for
   `FAILED_IRN`/`PENDING_IRN` rows.
7. **`.env.example`** — added `NIC_IRP_URL`, `NIC_EWB_URL`, `NIC_API_KEY`,
   `NIC_USERNAME`, `NIC_PASSWORD` (the pre-existing code already read these at runtime;
   they were just never documented).
8. **Schema**: added `CANCEL_REQUIRED_MANUALLY` to `einvoice_data.irn_status`'s type
   union (varchar column, no DB constraint — no migration needed).

## Deviations From the Prompt
- **No new `packages/platform-sdk/src/nicClient.ts`.** The prompt assumed no NIC client
  existed; `EInvoiceService`/`EwayBillService` in `gst-service` already implement this
  role directly (auth via static `NIC_API_KEY` header, not the two-step
  authenticate-for-JWT flow the prompt describes). Extracting that into a new
  `platform-sdk` class would mean rewriting already-working, already-tested code with no
  functional benefit — out of scope per "surgical changes."
- **Money is decimal rupees, not integer paise.** The prompt's "Money Rules" section
  describes paise-integer amounts needing `/100` conversion for NIC. This codebase's
  actual schema (`invoices`, `invoice_lines`, `gst_ledger`, etc.) stores
  `decimal(15,2)` rupee amounts throughout — confirmed by direct inspection before
  writing `buildNicPayload`. No conversion is applied; values are used as-is.
- **E-invoice applicability** is determined per-invoice by "does the customer have a
  GSTIN on file" (B2B) rather than a tenant-level turnover-threshold config. This
  codebase has no tenant turnover/e-invoice-mandate setting to hook into, and inventing
  one wasn't asked for. B2C invoices are simply never auto-submitted (status stays the
  implicit `NOT_APPLICABLE` default — no `einvoice_data` row is created for them).
- **Retry model is layered, not purely per-call.** The prompt asks for "3× exponential
  backoff" as the sole retry mechanism. This codebase already had a complementary
  15-minute scheduler job (`gst.e-invoice-retry` in `scheduler-service`) that retries
  `PENDING_IRN` records up to 5 times. Both are kept: `fetchWithRetry` handles
  transient failures within a single call (429/5xx), the scheduler job remains the
  safety net for network-timeout cases that never got a response at all.
- **EWB generation stays manual only.** Auto-generating an E-Way Bill would need
  transport details (vehicle number, transporter GSTIN, mode) that don't exist anywhere
  until a human enters them — there's no invoice-time capture of this data to build a
  payload from. The existing manual `POST /gst/eway-bill/generate` flow (already built,
  unit-tested against the ₹50,000 threshold) is unchanged.
- **QR code is shown as a "QR ready" indicator, not a rendered barcode image.** No QR
  rendering library exists in `web-frontend`; adding one for a single indicator was
  judged out of scope. The signed QR string itself is already visible via the existing
  single-invoice lookup panel.

## Incidental Fix (pre-existing, unrelated to ES-11, needed to unblock tests)
`packages/logger/src/erp-metrics.ts` registered all Prometheus `Counter`/`Gauge` metrics
with plain `new Counter(...)`/`new Gauge(...)` at module load. gst-service previously had
only one test file, so this never surfaced; adding a second and third test file
(`einvoice.test.ts`, `ewb.test.ts` — both import modules that call `createLogger`)
exposed a pre-existing collision: Vitest reloads the module fresh per test file, but the
underlying `prom-client` default registry persists across those reloads within the same
worker, so the second load throws "metric already registered." Fixed by making
registration idempotent (`register.getSingleMetric(name) ?? new Counter(...)`) — no
behavior change in production, where each metric is still only ever registered once.
Also fixed a latent `exactOptionalPropertyTypes` compile error in the same file's
`initializeErpMetrics` (pre-existing, unrelated to the metrics change, surfaced only
because this was the first time this session compiled the package) by building the
`collectDefaultMetrics` config object conditionally instead of assigning
`register: undefined`.

## Files Changed
| File | Change |
|------|--------|
| `apps/gst-service/src/domain/EInvoiceService.ts` | `buildNicPayload()`, `retrySingle()`, retry-with-backoff wired into `generateIrn`/`cancelIrn` |
| `apps/gst-service/src/domain/EwayBillService.ts` | retry-with-backoff wired into `generate()` |
| `apps/gst-service/src/domain/nicRetry.ts` | NEW — shared `fetchWithRetry()` helper |
| `apps/gst-service/src/consumers/EInvoiceEventConsumer.ts` | NEW — auto IRN generate/cancel on `INVOICE_CONFIRMED`/`INVOICE_CANCELLED` |
| `apps/gst-service/src/api/einvoice.routes.ts` | `POST /gst/einvoice/retry/:invoiceId`, `GET /gst/einvoice/list` |
| `apps/gst-service/src/main.ts` | wired new consumer; added `erp.invoice.cancelled` topic |
| `packages/db-client/src/schema/gst.ts` | `einvoice_data.irn_status` type union gains `CANCEL_REQUIRED_MANUALLY` |
| `apps/web-frontend/src/pages/gst/EInvoicePage.tsx` | STUB banner removed; new `EInvoiceListTable` with status/EWB columns + Retry action |
| `apps/web-frontend/src/api/endpoints.ts` | `gstApi.einvoiceList()`, `gstApi.retryIrn()` |
| `.env.example` | `NIC_IRP_URL`, `NIC_EWB_URL`, `NIC_API_KEY`, `NIC_USERNAME`, `NIC_PASSWORD` |
| `apps/gst-service/src/__tests__/einvoice.test.ts` | NEW — tests 1, 2, 3, 6, 7 (4, 5 skipped — need live NIC sandbox) |
| `apps/gst-service/src/__tests__/ewb.test.ts` | NEW — tests 8, 9 |
| `packages/logger/src/erp-metrics.ts` | incidental pre-existing bug fixes (see above) |

## Tests: 14/14 PASS (2 skipped — integration tests requiring live NIC sandbox network access) | type-check: PASS | build: PASS

```
pnpm --filter @erp/db build                 PASS
pnpm --filter @erp/sdk build                PASS  (platform-sdk)
pnpm --filter @erp/logger build             PASS
pnpm --filter @erp/gst-service build        PASS
pnpm --filter @erp/gst-service type-check   PASS
pnpm --filter @erp/web-frontend build       PASS (tsc --noEmit)
pnpm --filter "...@erp/logger" build        PASS (all 17 dependents, incl. every microservice)
pnpm --filter @erp/gst-service test         PASS (14/14, 2 skipped)
pnpm --filter @erp/sales-service test       PASS (22/22, 3 skipped — no DATABASE_URL) — no regression
```

**Lint**: `pnpm --filter @erp/gst-service lint`, `@erp/db lint`, `@erp/logger lint`, and
`@erp/web-frontend lint` all show only the same pre-existing `no-undef: process/fetch/
crypto/AbortSignal/setTimeout` baseline gap already documented in ES-01/ES-09/ES-10 (ERP-
wide ESLint config lacks `globals: { process: 'readonly', fetch: 'readonly', ... }`), plus
a couple of pre-existing unused imports (`lte` in `EInvoiceService.ts`, `NotFoundError` in
`EwayBillService.ts` — both present before this phase, untouched). My new files
(`nicRetry.ts`, `EInvoiceEventConsumer.ts`) follow the exact same pattern as their
siblings and introduce no new category of lint error. `gst.ts`'s one-line schema change
has zero lint findings.

## Verification Checklist
- [x] `buildNicPayload()` unit-tested: correct structure, intra-state CGST+SGST/IGST=0,
      inter-state IGST/CGST=SGST=0
- [x] IRN auto-generation wired to `INVOICE_CONFIRMED` (B2B only) — code path unit-tested
      via retry/failure transitions; not exercised against a live confirmed invoice (no
      local Postgres/Kafka available in this session, consistent with prior phases)
- [x] `EInvoicePage.tsx` shows real IRN status — STUB banner is REMOVED
- [x] "Retry" button manually triggers for FAILED_IRN/PENDING_IRN invoices
- [x] Invoice cancellation triggers IRN cancellation flow (within 24h) or marks
      `CANCEL_REQUIRED_MANUALLY` (past 24h)
- [x] E-Way Bill generation unit-tested for the ₹50,000 threshold and success storage
      (pre-existing manual flow, unchanged)
- [x] 14/14 runnable tests pass (2 skipped, documented reason)
- [x] `.env.example` has NIC credential placeholders
- [x] `pnpm lint` on touched packages — no new errors beyond documented pre-existing baseline

## Regression Checklist
- [x] Invoice confirmation still works — the new einvoice consumer catches its own
      errors and never throws back into the event dispatcher, so a NIC issue can't fail
      GST-ledger recording for the same `INVOICE_CONFIRMED` event
- [x] Existing GST pages (GSTR-9, GSTR-1/3B, RCM register) untouched, still load
- [x] `sales-service` test suite: 22/22 pass, no regression from the `@erp/logger` fix
- [x] All 17 packages depending on `@erp/logger` (every microservice) build clean after
      the metrics-registration fix

## Phases Unblocked
None currently pending on this — ES-17 (analytics) can optionally surface IRN/EWB
status data now that it's queryable via `GET /gst/einvoice/list`.
