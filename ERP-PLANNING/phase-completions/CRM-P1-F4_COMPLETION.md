# CRM-ROADMAP Phase 1, Feature 4 — Support & Ticketing — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Complaints previously lived only as an untracked `customer_interactions` COMPLAINT type — no
SLA, no status machine, no assignment. This feature adds a real ticket entity per
`ERP-PLANNING/CRM-ROADMAP/10-PHASE-1-FOUNDATION.md`'s Feature 4 spec:

- New `crm_tickets` (status `Open → In Progress → Waiting on Customer → Resolved → Closed`),
  `crm_ticket_messages` (internal notes vs. customer-visible replies — the critical
  security/privacy boundary this feature adds), `crm_ticket_sla_rules` (by ticket
  type/customer tier/priority), and `crm_csat_responses`.
- `TicketService` (`apps/sales-service/src/domain/TicketService.ts`): most-specific-match SLA
  resolution (falls back to a 48-hour default so every tenant works before configuring rules),
  auto-links the customer's most recent invoice within a 30-day window at creation, an
  explicit-only reopen rule, and the SLA-breach sweep (marks overdue open tickets breached,
  writes a `TICKET_SLA_BREACHED` outbox event with full context).
- New `apps/sales-service/src/api/ticket.routes.ts`: full CRUD, `/tickets/:id/assign`,
  `/tickets/:id/reopen`, `/tickets/:id/messages` (visibility required on every message, never
  defaulted), `/tickets/:id/csat` — all branch-scoped per AR-6.
- New internal-key-guarded `POST /api/v2/crm/tickets/sla-breach-sweep` in `internal.routes.ts`,
  called every 5 minutes by a new `scheduler-service` cron job
  (`crm.ticket-sla-breach-sweep`), which also dispatches the escalation notification to the
  assignee — mirroring the exact pattern the pre-existing `credit-limit-review/run` internal
  route already uses (business logic, including "who to notify," stays in the owning service;
  the scheduler job is a thin HTTP caller).
- Six new `TICKET_*` permissions, granted to `SALES_MANAGER`.
- Frontend: an inbox-style ticket list (`TicketsPage`, SLA countdown chips), ticket detail
  (`TicketDetailPage`, message thread with a visible Internal/Customer-visible tag per
  message, order/invoice context panel, resolve/close/reopen/CSAT actions), and a "+ New
  Ticket" quick action on the Customer 360 page (Feature 3) that pre-fills the customer —
  matching the phase doc's own stated Playwright scenario 1 entry point.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **Reopen rule, explicitly decided per the spec's own instruction to do so:** reopening a
   `CLOSED` ticket is only possible via the dedicated `POST /tickets/:id/reopen` action, never
   implicit from a new customer reply. It transitions to `IN_PROGRESS` (not back to `OPEN`,
   since assignment/history already exist), increments `reopenedCount`, and logs an `INTERNAL`
   note — all covered directly in `ticket-service.test.ts`.
2. **`CLOSED` requires `RESOLVED` first.** `PUT /tickets/:id` rejects a direct `OPEN`/`IN_PROGRESS`
   → `CLOSED` transition (`MUST_RESOLVE_FIRST`) — matches the status machine's own ordering in
   the spec text rather than allowing a same-step skip.
3. **CSAT is staff-recorded, not customer-submitted.** Phase 1 has no customer-facing portal
   (that's Phase 3) — `POST /tickets/:id/csat` is called by whoever closed the loop with the
   customer (over phone/in person), not a public survey link. One response per ticket
   (unique constraint), gated by `TICKET_RESOLVE`.
4. **No customer-search autocomplete component built for manual ticket creation.** The phase
   doc's own Playwright scenario 1 is "Create a ticket manually **from Customer 360**" — so
   `TicketFormPage` accepts `customerId` via a query param pre-filled by that exact entry
   point, rather than requiring a new customer-search UI component that isn't otherwise used
   anywhere in this codebase. A standalone `/crm/tickets/new` (no query param) falls back to a
   plain numeric customer-ID input — functional but not the primary intended flow.
5. **Notification dispatch lives in sales-service's internal route, not the scheduler job** —
   deliberately mirrors the pre-existing `credit-limit-review/run` route's exact shape rather
   than inventing a new pattern (business logic in the owning service; scheduler-service stays
   a thin HTTP caller across all ~34 of its jobs).

## Acceptance Criteria

- [x] A complaint raised via any channel becomes a tracked ticket with a visible SLA clock —
      `TicketService.create` always computes `slaDueAt` (rule-matched or the 48h default);
      `TicketsPage`/`TicketDetailPage` render a live countdown/breach chip.
- [x] Resolution closes the loop with the customer notified — `PUT /tickets/:id` with
      `status: 'RESOLVED'` publishes `TICKET_RESOLVED`; the customer-visible reply thread is
      the mechanism for direct customer communication (Phase 1 has no customer notification
      channel of its own beyond what already exists via `notification-service`, unchanged by
      this feature).
- [x] CSAT is captured — `POST /tickets/:id/csat`, one per ticket, visible in ticket detail.
- [x] Internal notes never leak into the customer-visible view — the one assertion the spec
      says to be "paranoid about": `MessageSchema.visibility` has no default (every message
      must declare it explicitly), and `ticket-service.test.ts` verifies an `INTERNAL` message
      and a `CUSTOMER_VISIBLE` message on the same ticket are stored and retrieved with their
      exact, distinct visibility values — never conflated — and that filtering for the
      customer-visible subset never includes the internal one.
- [x] A ticket with no linked order is still valid (general inquiry) — `linkedInvoiceId` stays
      unset when no recent invoice exists; covered directly.
- [x] Reopening a Closed ticket is an explicit action, documented and tested (see Decision #1).
- [x] An internal note posted by a since-removed employee still renders, correctly attributed —
      `authorName` is a denormalized snapshot at post time, not a live join to `users`; covered
      directly with an `authorId` that doesn't correspond to any real user row.
- [x] SLA-breach sweep job is indexed, not a full-table scan — `idx_crm_tickets_status_sla`
      on `(tenant_id, status, sla_due_at)`.
- [x] `TICKET_SLA_BREACHED`'s outbox event carries full context, not just IDs — payload
      includes `ticketNumber`, `subject`, `customerId`, `assignedTo`, `slaDueAt`.

## Verification performed this session

- `pnpm --filter @erp/types build` / `pnpm --filter @erp/db build` — clean.
- `pnpm --filter sales-service type-check` / `pnpm --filter tenant-service type-check` /
  `pnpm --filter web-frontend type-check` / `pnpm --filter scheduler-service type-check` — all
  clean.
- `eslint` scoped to every touched/new file — 0 errors (pre-existing-style warnings only).
- **Live migration + integration test run** against the local dev Postgres: applied
  `0110_crm_ticketing.sql` and `0111_crm_ticket_permission_backfill.sql` directly, then ran
  `ticket-service.test.ts` — **10/10 passing** (SLA-rule specificity ×3, auto-link-order ×2,
  message-visibility separation ×2, reopen-rule ×2, SLA-sweep-with-escalation ×1).
- `pnpm --filter scheduler-service test -- system-jobs` — **9/9 passing**, confirming the new
  `crm.ticket-sla-breach-sweep` job registration didn't break the existing job registry.
- **Full regression check across Features 1–4**: re-ran `account-service.test.ts` (5),
  `lead-service.test.ts` (10), `lead-capture-auth-isolation.test.ts` (4),
  `customer-360-degradation.test.ts` (1), and `customer.integration.test.ts` (5) alongside this
  session's new tests — **35/35 passing, zero regressions**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — `ticket.routes.ts` is **not** in
  the failure list; the test's 2 failures are the same pre-existing ones from every prior
  session in this roadmap, in files this feature never touched.

## Files touched

- `packages/db-client/src/schema/crm.ts` — `crmTickets`/`crmTicketMessages`/
  `crmTicketSlaRules`/`crmCsatResponses` tables + type exports.
- `packages/db-client/migrations/0110_crm_ticketing.sql` — new tables.
- `packages/db-client/migrations/0111_crm_ticket_permission_backfill.sql` — new; backfills
  `TICKET_VIEW/CREATE/UPDATE/ASSIGN/RESOLVE/DELETE` for existing tenants' `SALES_MANAGER` role.
- `packages/db-client/migrations/meta/_journal.json` — appended entries.
- `packages/shared-types/src/permissions.ts` — new `TICKET_VIEW/CREATE/UPDATE/ASSIGN/RESOLVE/DELETE`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — added the six new constants to `SALES_MANAGER`.
- `apps/sales-service/src/domain/TicketService.ts` — new.
- `apps/sales-service/src/api/ticket.routes.ts` — new.
- `apps/sales-service/src/api/internal.routes.ts` — new `/crm/tickets/sla-breach-sweep`
  internal route.
- `apps/sales-service/src/main.ts` — registered `ticketRoutes`.
- `apps/sales-service/src/__tests__/ticket-service.test.ts` — new; 10 tests.
- `apps/scheduler-service/src/jobs/system-jobs.ts` — new `crm.ticket-sla-breach-sweep` job.
- `apps/web-frontend/src/api/endpoints.ts` — new `ticketApi`.
- `apps/web-frontend/src/schemas/ticket.schema.ts` — new.
- `apps/web-frontend/src/pages/crm/TicketsPage.tsx` / `TicketDetailPage.tsx` /
  `TicketFormPage.tsx` — new.
- `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` — new "+ New Ticket" quick action.
- `apps/web-frontend/src/lib/navigation.ts` — new "Tickets" nav item under CRM.
- `apps/web-frontend/src/App.tsx` — new `/crm/tickets[/new|/:id]` routes.

## What is not done (remaining TODO)

| Item                                                                                | Why deferred                                                                                                                                 | Target                                                    |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Playwright E2E specs for the 5 scenarios in the phase doc                           | Not run this session (no browser harness invoked); logic covered instead by live DB integration tests                                        | Follow-up before Phase 1 sign-off                         |
| `crm_ticket_sla_rules` management UI                                                | No dedicated page built this session — rules can only be seeded directly; the default-fallback SLA (48h) means the feature works without one | Add if tenants need tier-specific SLAs beyond the default |
| Customer-search autocomplete for the standalone `/crm/tickets/new` (no query param) | Falls back to a plain numeric ID input; the primary flow (from Customer 360) doesn't need it                                                 | Build if the standalone entry point sees real use         |
| Live SLA-breach escalation exercised end-to-end (notification actually delivered)   | No live notification-service call made this session, only the sweep logic itself (mocked/DB-level)                                           | Follow-up before Phase 1 sign-off                         |

## Deployment Checklist

- [ ] Run migrations `0110_crm_ticketing.sql` and `0111_crm_ticket_permission_backfill.sql`
      against every target database (staging/prod) — verified applied against the local dev
      DB this session only.
- [ ] No new environment variables (the SLA-sweep job reuses `SALES_SERVICE_URL`/
      `INTERNAL_API_KEY`, already configured for every other scheduler-service job).
