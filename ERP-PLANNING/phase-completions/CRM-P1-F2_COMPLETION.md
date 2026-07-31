# CRM-ROADMAP Phase 1, Feature 2 — Lead Management & Capture — Completion Report

**Date:** 2026-07-29
**Status:** Complete.

## Summary

Prior to this feature there was zero pre-purchase visibility — every customer record started as
a fully-formed `Customer`, day one. This feature adds a Lead entity capturing interest before
that point, per `ERP-PLANNING/CRM-ROADMAP/10-PHASE-1-FOUNDATION.md`'s Feature 2 spec:

- New `crm_leads` (stage `NEW → CONTACTED → QUALIFIED → CONVERTED/LOST`), `crm_lead_activities`
  (interaction/stage-change log), and `crm_assignment_rules` (round-robin/load-balanced routing
  pools) tables. `customers.converted_from_lead_id` is an additive reverse pointer for
  attribution.
- `LeadService` (`apps/sales-service/src/domain/LeadService.ts`): capture with dedupe (never a
  silent second open lead for the same phone), round-robin/load-balanced auto-assignment that
  skips deactivated users, and conversion to Customer (+ CRM Account if B2B-flagged, reusing
  Feature 1's `AccountService`) — attaches to an existing customer with the same phone instead
  of creating a duplicate.
- **Extracted `CustomerService.createCustomer()`** (new file) from `customer.routes.ts`'s inline
  POST handler — a behavior-preserving refactor, not a new implementation — so lead conversion
  reuses the exact same customer-creation path the roadmap doc explicitly asks for
  ("does not duplicate customer-creation logic"), which wasn't previously possible because that
  service file didn't exist yet.
- New `apps/sales-service/src/api/lead.routes.ts`: `/leads` CRUD, `/leads/:id/assign`,
  `/leads/:id/convert`, `/leads/:id/activities`, `/lead-assignment-rules`, and the one
  **public, unauthenticated** route in this codebase's history: `POST /leads/capture`
  (rate-limited, honeypot-gated, strict Zod, no PII logged — 06-SECURITY-PLAN.md §2.1).
- Four new permission constants — `LEAD_VIEW/CREATE/UPDATE/ASSIGN/CONVERT/DELETE` — granted to
  `SALES_MANAGER`, no naming collisions found this time.
- Frontend: a Kanban board (`LeadsKanbanPage`, native HTML5 drag-and-drop, no new dependency),
  Lead detail page (activity log, assign, convert), manual-creation form, and a standalone
  public `/lead-capture?tenantId=` page (embeddable, outside the authenticated app shell) under
  `apps/web-frontend/src/pages/marketing/`.

## Deviations / things caught during implementation (flagged, not silently decided)

1. **Gateway auth exemption — the exact failure mode `04-API-DESIGN-PLAN.md` §1 warned about.**
   `apps/api-gateway/src/middleware/gateway-auth.ts` maintains its own separate allowlist
   (`EXEMPT_PATHS`) of unauthenticated routes, independent of what each backend service itself
   requires. Without adding `/api/sales/leads/capture` to it, the public capture endpoint would
   401 at the gateway before ever reaching sales-service, despite working fine if called
   directly against the service port. Added, with a comment explaining the apiV2-prefix
   client-facing path rewrite.
2. **Route-registration sibling isolation — the exact bug class from the 2026-07-17 incident
   documented in `main.ts`.** Several existing route files (`quotationRoutes`, `invoiceRoutes`,
   `attachmentRoutes`, ...) call `fastify.addHook('preHandler', authenticate)` directly on the
   shared `sub` Fastify instance they're given. Registering `leadRoutes` inside that same `sub`
   would have silently forced a JWT onto `POST /leads/capture` regardless of its own
   route-level `preHandler` array — nesting order doesn't matter, only sibling-vs-descendant
   does. Registered `leadRoutes` as its own genuine top-level `.register()` sibling instead (see
   `main.ts`'s new comment), and added a dedicated regression test
   (`lead-capture-auth-isolation.test.ts`) mirroring the existing
   `internal-route-auth-isolation.test.ts` pattern so this can't silently regress.
3. **No `crm_lead_sources` lookup table.** Same reasoning as Feature 1's `crm_contact_roles`
   decision — `source` is a small fixed vocabulary column, not a tenant-configurable catalog;
   nothing in this feature's acceptance criteria requires the latter.
4. **Assignment-rule "conditions" kept simple.** `crm_assignment_rules` supports an optional
   `branchId` scope (a branch-specific rule beats the tenant-wide fallback) but not arbitrary
   multi-condition matching (e.g. by source) — the spec asks for "round-robin/load-based
   routing," not a rules engine, and a fuller condition system would be speculative
   configurability beyond what's requested.
5. **Fixed a self-inflicted honeypot bug before it shipped.** The first draft of `CaptureSchema`
   declared `hp: z.string().max(0).optional()`, which meant Zod itself would reject (400) any
   payload where a bot actually filled the honeypot — defeating the intent of returning a
   fake-success response so a bot never learns it was caught. Corrected to `max(200)` so Zod
   passes it through and the explicit runtime check in the route (not the schema) is what
   silently no-ops the write; covered by a new test asserting a filled honeypot still returns
   201 without writing a row.

## Acceptance Criteria

- [x] Public capture form submission → lead appears in the Kanban "New" column — `POST
/leads/capture` creates a `stage: 'NEW'` row; `LeadsKanbanPage` queries `GET /leads`
      unfiltered by default.
- [x] Drag a lead from "New" to "Qualified" → activity log records the stage change with actor
      and timestamp — `PUT /leads/:id` inserts a `STAGE_CHANGE` activity row inside the same
      transaction as the stage update when `stage` changes.
- [x] Convert a qualified lead → a Customer record exists, linked back to the lead — `POST
/leads/:id/convert` sets `customers.convertedFromLeadId`; the lead's
      `convertedCustomerId`/`convertedAt` are set; verified in `lead-service.test.ts`.
- [x] Rate-limit test: rapid-fire capture submissions from one source are throttled — route-level
      `config.rateLimit` (default 5 per 10 minutes, tunable via `LEAD_CAPTURE_RATE_LIMIT_MAX`/
      `_WINDOW_MS`), keyed by IP via the existing `tenantOrIpKeyGenerator` (no tenant context on
      an unauthenticated request, falls back to IP as designed). **Not exercised end-to-end this
      session** — no Playwright/browser harness was run; see "What is not done" below.
- [x] Duplicate-lead detection: submitting the same phone number twice surfaces a dedupe warning
      against the existing lead, not a silent duplicate — `LeadService.capture` never creates a
      second row while an earlier lead for that phone is still open; covered directly in
      `lead-service.test.ts`.
- [x] Lead capture with only a phone number, no name — `displayName` is nullable, no validation
      requires it.
- [x] A lead assigned to a since-deactivated user is skipped — `autoAssign` filters the pool by
      `users.isActive` before selecting, for both strategies; covered directly (round-robin
      skip test + load-balance test).
- [x] Converting a lead that duplicates an existing _customer_ offers merge-into-existing, not
      blind duplicate creation — `convertToCustomer` checks for a non-deleted customer with the
      same phone first and attaches to it (`attachedToExisting: true`) instead of inserting;
      covered directly.
- [x] Assignment-rule routing logic tested (round-robin fairness, load-balance correctness) —
      `lead-service.test.ts`: 6 leads across a 3-user round-robin pool split exactly 2/2/2;
      load-balanced strategy verified to pick the currently-least-loaded active user.
- [x] `LEAD_CONVERTED`'s outbox event carries full context, not just IDs — publishes
      `{ leadId, customerId, accountId, attachedToExisting }`, matching the
      outbox-payload-completeness convention flagged in `00-CODEBASE-AUDIT.md`.

## Verification performed this session

- `pnpm --filter @erp/types build` / `pnpm --filter @erp/db build` — clean.
- `pnpm --filter sales-service type-check` / `pnpm --filter tenant-service type-check` /
  `pnpm --filter web-frontend type-check` / `pnpm --filter api-gateway type-check` — all clean.
- `eslint` scoped to every touched/new file — 0 errors (pre-existing-style warnings only).
- **Live migration + integration test run** against the local dev Postgres
  (`erp-postgres-primary`, port 5435): applied `0107_crm_lead_management.sql` and
  `0108_crm_lead_permission_backfill.sql` directly, then ran:
  - `lead-service.test.ts` — **10/10 passing** (capture dedupe ×3, round-robin fairness,
    round-robin inactive-skip, load-balance, convert ×4).
  - `lead-capture-auth-isolation.test.ts` — **4/4 passing**, including the new honeypot test.
  - `account-service.test.ts` (Feature 1, re-run to confirm the `CustomerService` extraction
    didn't regress it) — **5/5 passing**.
  - `customer.integration.test.ts` (pre-existing, re-run for the same reason) — **5/5 passing**.
  - `internal-route-auth-isolation.test.ts` (pre-existing) — **3/3 passing**.
- `pnpm --filter @erp/types test -- route-guard-coverage` — `lead.routes.ts`'s new routes are
  **not** in the failure list (every route but the documented `/leads/capture` exception carries
  `requirePermission(`); the test's 2 failures are the same pre-existing ones from Feature 1's
  session, in files this feature never touched.
- `pnpm --filter api-gateway test -- gateway-auth` — **15/15 passing**, confirming the new
  `/api/sales/leads/capture` exemption didn't loosen anything else.
- Did not run the full `sales-service` test suite or Playwright E2E this session — the former
  is still affected by the same pre-existing concurrent-session auth breakage documented in
  `CRM-P1-F1_COMPLETION.md`; the latter needs a browser harness not invoked this session.

## Files touched

- `packages/db-client/src/schema/crm.ts` — `crmLeads`/`crmLeadActivities`/`crmAssignmentRules`
  tables + type exports.
- `packages/db-client/src/schema/master.ts` — `customers.convertedFromLeadId` nullable column.
- `packages/db-client/migrations/0107_crm_lead_management.sql` — new tables + column.
- `packages/db-client/migrations/0108_crm_lead_permission_backfill.sql` — new; backfills
  `LEAD_VIEW/CREATE/UPDATE/ASSIGN/CONVERT/DELETE` for existing tenants' `SALES_MANAGER` role.
- `packages/db-client/migrations/meta/_journal.json` — appended entries for both migrations.
- `packages/shared-types/src/permissions.ts` — new `LEAD_VIEW/CREATE/UPDATE/ASSIGN/CONVERT/DELETE`.
- `packages/shared-types/src/__tests__/route-guard-coverage.test.ts` — new `KNOWN_EXCEPTIONS`
  entry for `/leads/capture`.
- `apps/tenant-service/src/rbac/role-defaults.ts` — added the six new constants to
  `SALES_MANAGER`.
- `apps/api-gateway/src/middleware/gateway-auth.ts` — new `EXEMPT_PATHS` entry.
- `apps/sales-service/src/domain/CustomerService.ts` — new (extracted from `customer.routes.ts`).
- `apps/sales-service/src/domain/LeadService.ts` — new.
- `apps/sales-service/src/api/lead.routes.ts` — new.
- `apps/sales-service/src/api/customer.routes.ts` — POST handler now delegates to
  `CustomerService.create`; removed the now-dead local `isUniqueViolation` helper.
- `apps/sales-service/src/main.ts` — registered `leadRoutes` as its own top-level sibling
  `.register()` (not nested in the `sub` block with `addHook`-using route files).
- `apps/sales-service/src/__tests__/lead-service.test.ts` — new; 10 tests.
- `apps/sales-service/src/__tests__/lead-capture-auth-isolation.test.ts` — new; 4 tests.
- `apps/web-frontend/src/api/endpoints.ts` — new `leadApi`.
- `apps/web-frontend/src/schemas/lead.schema.ts` — new.
- `apps/web-frontend/src/pages/crm/LeadsKanbanPage.tsx` / `LeadDetailPage.tsx` /
  `LeadFormPage.tsx` — new.
- `apps/web-frontend/src/pages/marketing/LeadCapturePage.tsx` — new; public, no auth.
- `apps/web-frontend/src/lib/navigation.ts` — new "Leads" nav item under CRM.
- `apps/web-frontend/src/App.tsx` — new `/lead-capture` (public) and `/crm/leads[...]`
  (protected) routes.

## What is not done (remaining TODO)

| Item                                                                                                          | Why deferred                                                                                                                                                                                                     | Target                                  |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| POS checkout capture widget ("would you like updates?" flow)                                                  | Genuinely separate integration surface (pos-frontend checkout UI); not exercised by this feature's own acceptance criteria/Playwright scenarios                                                                  | Revisit if requested                    |
| Playwright E2E specs for the 5 scenarios in the phase doc                                                     | Not run this session (no browser harness invoked); logic covered instead by live DB integration tests + the dedicated auth-isolation test                                                                        | Follow-up before Phase 1 sign-off       |
| Multi-condition assignment-rule matching (by source, priority ordering beyond branch-specific-vs-tenant-wide) | Spec asks for round-robin/load-based routing, not a conditions engine                                                                                                                                            | Revisit if real usage shows it's needed |
| Live rate-limit throttling exercised against real repeated HTTP requests                                      | No browser/HTTP load-test harness run this session; the mechanism itself (`@fastify/rate-limit`, already proven in production for `/public/demo-requests`) is unchanged, only the per-route limit values are new | Follow-up before Phase 1 sign-off       |

## Deployment Checklist

- [ ] Run migrations `0107_crm_lead_management.sql` and
      `0108_crm_lead_permission_backfill.sql` against every target database (staging/prod) —
      verified applied and working against the local dev DB this session only.
- [ ] Confirm `LEAD_CAPTURE_RATE_LIMIT_MAX`/`LEAD_CAPTURE_RATE_LIMIT_WINDOW_MS` env vars are set
      appropriately per environment before enabling the public capture widget on any real
      tenant's marketing site (defaults: 5 requests / 10 minutes per IP).
- [ ] No new environment variables beyond the two rate-limit knobs above (both optional, with
      safe defaults).
