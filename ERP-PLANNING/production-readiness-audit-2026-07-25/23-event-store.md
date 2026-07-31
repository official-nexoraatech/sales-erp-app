# Event Store Admin — Production Readiness Audit (2026-07-25)

Scope: `apps/event-service/src/api/event-store.routes.ts` (backend) +
`apps/web-frontend/src/pages/admin/distributed/EventStorePage.tsx` (frontend).
This is the event-sourcing audit-trail / replay feature, distinct from the broader
Event Service (outbox/saga/DLQ) audit done earlier this session.

All findings below are from live verification against the running stack (gateway
:3000, event-service :3023, Postgres-backed tenant 2 "QA E2E Test Co"), not from
reading code alone, except where explicitly marked "code-only."

## Summary — resolving the "empty vs shipped" contradiction

**Both prior notes were correct at their respective times, and the contradiction is
resolved: the write path was genuinely built and shipped on 2026-07-16, and the
2026-07-13 "permanently empty, no write path" finding is now stale.** This is
directly corroborated by the codebase itself — `apps/web-frontend/src/dap/content/tours/admin/events.tour.ts`
carries a developer comment: _"an earlier audit found this page permanently empty
(no write path existed at all). That's now fixed — EventStoreService.append() is
genuinely called from InvoiceService (create/confirm/cancel) and PaymentService."_

Live proof in this session: queried `GET /api/v2/admin/events/store` on event-service
directly and got 36 real rows for tenant 2. Then created a brand-new invoice
(`POST /api/sales/invoices`, id 131) through the gateway and re-queried — a new
`INVOICE_CREATED` event (`eventId 01KYBXG32JNAK39NZVQV1XVRSW`) appeared immediately
(same request/transaction, not eventually-consistent via Kafka). Then called
`POST /api/v2/admin/events/replay/Invoice/131` and got back a correctly rebuilt
aggregate state (`grandTotal: "1050"` = ₹1000 line + 5% GST, matching the real
invoice). Both the append path and the replay/rebuild path are real and functionally
correct.

**However, the scope is narrow and this is itself explicitly documented in-app** (the
same tour file, step "scope-is-narrow": _"Currently scoped to Invoice and Payment
only... Other filter options in the dropdown (Customer, Item, Stock events) will
always return empty — no other domain writes to this log today."_). So the
narrow scope is a known, disclosed limitation, not a hidden gap — but see Finding 1
below: even the disclosed guidance is itself incomplete, because the two aggregate
types that DO have data are unreachable through the UI's own filter dropdown due to
a separate, undocumented bug.

## What works (verified live)

- **Write path (Invoice/Payment only)**: `EventStoreService.append()` in
  `packages/platform-sdk/src/event-store.ts` is called from exactly two places in
  the whole monorepo — `apps/sales-service/src/domain/InvoiceService.ts` (on
  create/confirm/cancel, 3 call sites) and `apps/sales-service/src/domain/PaymentService.ts`
  (on payment allocation). Verified live: creating invoice 131 produced a new event
  row within the same request.
- **Replay / rebuild aggregate state**: `POST /admin/events/replay/:aggregateType/:aggregateId`
  correctly folds the event stream into a state object via `EventStoreService.rebuild()`.
  Verified live against real invoice 131 (grandTotal computed correctly) and against
  a nonexistent aggregate (`Invoice/999999` → gracefully returns `{version: 0, state:
{}, events: []}`, no crash).
- **Payload inspection**: the "Inspect" button in the events table opens a modal
  showing the full `payload` and `metadata` as formatted JSON
  (`EventStorePage.tsx` lines 279–296) — confirmed this reflects exactly what the
  API returns (e.g. `{"status":"DRAFT","invoiceId":131,"customerId":1,"grandTotal":"1050"}`
  for the test invoice).
- **eventType filtering**: works correctly — `eventType=PAYMENT_RECEIVED` returned
  the correct 6 rows; the dropdown's other values (`INVOICE_CREATED`,
  `INVOICE_CONFIRMED`) also match real stored values exactly.
- **Date-range filtering**: `from`/`to` query params work correctly (verified
  `from=2026-07-20T00:00:00Z` narrowed 36 rows down to 25 as expected).
- **RBAC — enforced correctly**: `cashier@qa-e2e.local` (no `EVENT_STORE_VIEW`) got
  `403 FORBIDDEN` with a clear message; no token at all got `401 UNAUTHORIZED`.
  Granted to OWNER, ADMIN, SUPER_ADMIN, ACCOUNTANT, ACCOUNTANT_SUPERVISOR, AUDITOR
  (`apps/tenant-service/src/rbac/role-defaults.ts`) — denied to SALES_MANAGER,
  CASHIER, PURCHASE_MANAGER, INVENTORY_MANAGER, HR_MANAGER, STAFF, DATA_OFFICER.
  This is a sensible set (finance/oversight + admin roles) for a financial audit
  trail, not an accidental over-grant.
- **Multi-tenant isolation**: enforced correctly and not client-spoofable. The
  handler derives `tenantId` from `request.auth.tenantId` (the JWT claim set at
  login), never from a client-supplied header — verified live by sending the
  tenant-2 owner's token with a forged `x-tenant-id: 999` header; the response was
  still scoped to tenant 2's own 36+ events, the header was silently ignored.

## Bugs / gaps found

### 1. [HIGH] Aggregate Type filter dropdown is 100% non-functional — every option returns zero rows, including the two that have real data

`AGGREGATE_TYPES` in `EventStorePage.tsx` line 27 is
`['', 'INVOICE', 'PAYMENT', 'CUSTOMER', 'ITEM', 'STOCK']`. Live testing shows:

- `aggregateType=INVOICE` (the dropdown's literal value) → `{"data":[]}`. The
  actual stored value is `"Invoice"` (PascalCase, hardcoded in InvoiceService.ts —
  e.g. line 331: `aggregateType: 'Invoice'`). The DB query is an exact-match `eq()`
  (`packages/platform-sdk/src/event-store.ts` line 148), so the case mismatch makes
  this option always empty even though 36+ real Invoice events exist.
- `aggregateType=PAYMENT` → also always `{"data":[]}`, but for a different reason:
  payment events are deliberately recorded under `aggregateType: 'Invoice'`, never
  `'Payment'` — confirmed by both the live data (`PAYMENT_RECEIVED` rows all carry
  `"aggregateType":"Invoice"`) and a code comment at `PaymentService.ts` line
  181–183 explaining this is intentional design (payments fold into the invoice's
  replayed state). So "PAYMENT" as a standalone aggregate type simply doesn't exist
  in this system's data model — the dropdown option models a filter value that can
  never match anything, by design, not by oversight.
- `aggregateType=CUSTOMER` / `ITEM` / `STOCK` → always empty, per the documented
  scope gap (Finding 2).

**Net effect**: a user who picks _any_ value from the "Aggregate Type" dropdown gets
"No events match the current filters" — even immediately after creating an invoice
that plainly appears when no filter is applied. The one piece of in-app guidance
that exists (the DAP tour) only warns about Customer/Item/Stock being empty; it does
not mention that Invoice/Payment — the two types that actually work — are also
unreachable via this control. This is a straightforward, easily-reproduced UI bug:
the frontend constant should read `'Invoice'` (not `'INVOICE'`) and the `'PAYMENT'`
option should be removed (or the backend enum changed to match), not a data problem.

Business impact: filtering by aggregate type — the single most obvious way an
auditor or accountant would try to narrow down "show me this invoice's history" —
is currently unusable; the aggregate ID text field is the only working way to scope
a query per-entity.

### 2. [MEDIUM, documented/known] Event capture scope is Invoice + Payment lifecycle only — no other domain writes to the event store

Confirmed by exhaustive grep of the entire `apps/` tree for `new EventStoreService`
— it is instantiated in exactly 2 files, both in sales-service (InvoiceService.ts,
PaymentService.ts). No inventory-service, purchase-service, hr-service,
tenant-service, production-service, gst-service, or accounting-service code ever
writes to the event store. Live-confirmed: querying `aggregateType=CUSTOMER`,
`STOCK`, `ITEM` all return zero rows despite those entities having plenty of real
activity elsewhere in the same tenant (customers created, stock adjusted, items
updated per the accompanying Inventory/Purchase/HR audits done this session).

This is explicitly disclosed to users via the DAP tour (`events.tour.ts`), so it is
not a silent gap — but as a production-readiness matter it means "Event Store" as a
platform-wide event-sourcing/audit-trail feature does not exist; it is in practice
an "Invoice & Payment Lifecycle Log." Sales orders, GRNs, stock adjustments, HR
actions (leave, payroll, loans), and tenant/org-level actions (branch changes, user
role changes) have zero append-only event history here — any of those investigations
would have to fall back to the separate `VIEW_AUDIT_LOG`/audit-log feature (not this
one), or aren't captured anywhere at event-sourcing granularity.

### 3. [MEDIUM] "Rebuild Aggregate State" replay result is computed correctly but never shown to the user

`EventStorePage.tsx` lines 65–72: the mutation calls `eventStoreApi.replay(type,
id)`, which does receive the full rebuilt `{version, state, events}` payload from
the backend (verified live — the API genuinely returns the correct reconstructed
state). But `onSuccess` only fires a generic toast ("Aggregate state rebuilt from
event history") and invalidates the `event-store` list query — the actual returned
`state` object (the entire point of the "replay" feature — showing what the
aggregate's current state looks like when derived purely from its event history,
useful for verifying the event log matches reality) is discarded and never rendered
anywhere. A user has no way to see the rebuild's result short of opening browser dev
tools and reading the raw network response. Also, invalidating the events list after
a replay is a no-op refresh — replay/rebuild is read-only and never appends new
events, so nothing in the list actually changes.

### 4. [LOW] No pagination in the UI — only the newest 100 events are ever reachable

The query in `EventStorePage.tsx` line 54 hardcodes `limit: 100` and never sets
`offset`; there is no "load more" / page control in the UI, even though the backend
supports `offset` up to `limit=500` per page (`EventStoreQuerySchema`). At today's
volume (37 events for this tenant) this isn't yet felt, but once event volume grows
past 100, everything older than the 100 most recent events becomes permanently
unreachable through the UI (though still queryable directly against the API with an
explicit `offset`).

## Readiness score: 58/100

Justification: the core mechanics that matter for a production event-sourcing audit
trail — durable append-only writes, transactionally-consistent with the triggering
business action, correct tenant isolation, correct RBAC, and a working (if narrow)
replay/rebuild — are all real, live-verified, and correct. That's the majority of
the engineering risk retired. But the score is held down from "good" because:
(a) the primary filter control that exists specifically to make a browsable log
useful (Aggregate Type) is completely non-functional for every single one of its
values, including the two types with real data — a user cannot use the UI as
designed to scope down to "this invoice's history" via the dropdown at all;
(b) the feature's scope (2 of ~15 domains) means it cannot yet serve as a
platform-wide audit trail despite the "Event Store" naming and admin-nav placement
suggesting otherwise, even though this is now disclosed in-app; (c) the replay
feature's output — its whole reason for existing — is silently thrown away by the
frontend. None of these are data-loss or security risks (isolation and RBAC are
solid), which is why the score isn't lower, but they materially undercut the
feature's usability for its stated purpose today.
