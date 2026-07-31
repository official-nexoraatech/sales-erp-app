# PHASE DAP-1 — FOUNDATION & PILOT — COMPLETION REPORT

## Generated: 2026-07-19 | Status: PARTIALLY COMPLETE — see §6 and §12

> **This document is the official handoff artifact for Phase DAP-1.**
> **The next phase (DAP-2) MUST start by reading this document.**
> **Never modify this document after generation.**

---

## 1. PHASE SUMMARY

| Field    | Value                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase    | DAP-1 — Foundation & Pilot                                                                                                                                                                                                                       |
| Date     | 2026-07-19                                                                                                                                                                                                                                       |
| Status   | Code-complete, unit-tested, backend-verified live via direct API call. Full in-browser click-through **not completed** — blocked by host machine memory exhaustion encountered during verification, not a defect in this phase's code. See §6.3. |
| Engineer | Claude (Sonnet 5)                                                                                                                                                                                                                                |

---

## 2. WHAT WAS BUILT

### 2.1 Database Schema

```sql
-- Tables created (migration 0083_dap1_tour_progress_events.sql):
-- tour_progress (10 columns) — one row per (tenant, user, tour), upserted as the user advances
-- tour_events   (9 columns)  — append-only interaction log

-- Indexes:
-- idx_tour_progress_tenant_user, tour_progress_tenant_user_tour (unique)
-- idx_tour_events_tenant_tour, idx_tour_events_tenant_user
```

Applied to the dev DB and directly verified via `psql \d` (not just trusted from `drizzle-kit migrate`'s
own output — this repo has a documented history of that output silently no-op'ing on desynced journals,
see memory `db_migration_bookkeeping_broken`). Journal entry count (84) matches `.sql` file count (84)
before and after.

Note: `packages/db-client/drizzle-schema.ts` (drizzle-kit's actual CLI entry point) is a separate, stale,
partially-duplicated file from `src/schema/index.ts` — missing `hr`/`crm`/`distributed`/`search` schema
exports entirely, confirming `drizzle-kit generate` has not been the real mechanism for this repo's
schema evolution in a long time (hand-written migrations + manual journal entries is the actual, working
convention — see `packages/db-client/migrations/0002` through `0082`). Migration 0083 follows that real
convention. Flagging the `drizzle-schema.ts` drift here since it's a discoverable trap for the next
migration author, not fixed (out of scope for DAP-1).

### 2.2 APIs Implemented

| Method | Path                         | Permission                    | Status                 |
| ------ | ---------------------------- | ----------------------------- | ---------------------- |
| GET    | /api/v2/dap/progress         | authenticated only (own data) | ✅ Done, curl-verified |
| PUT    | /api/v2/dap/progress/:tourId | authenticated only (own data) | ✅ Done, curl-verified |
| POST   | /api/v2/dap/events           | authenticated only (own data) | ✅ Done, curl-verified |

No dedicated `PERMISSIONS.*` constant — every call scopes to the caller's own `tenantId`/`userId` from the
verified JWT, never from the request body (see ADR in `01_ARCHITECTURE.md`). Owned by event-service, next
to DLQ/Saga/Schema-Registry/Projections/Performance (`apps/event-service/src/api/dap.routes.ts`).

### 2.4 Frontend

| Piece                                         | Location                                                                             | Status                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Content schema (Zod)                          | `apps/web-frontend/src/dap/content/schema.ts`                                        | ✅ Done, unit-tested (10 tests)                                                |
| Content registry (auto-discovery)             | `apps/web-frontend/src/dap/content/registry.ts`                                      | ✅ Done, unit-tested (11 tests)                                                |
| Pilot tour content                            | `apps/web-frontend/src/dap/content/tours/cross-module/purchase-to-dashboard.tour.ts` | ✅ Done — 8 steps, real routes/permissions grepped from `App.tsx`, not guessed |
| TourProvider / useTour                        | `apps/web-frontend/src/dap/engine/TourProvider.tsx`, `useTour.ts`                    | ✅ Done, unit-tested (9 behavioral tests)                                      |
| TourOverlay / TourSpotlight / TourTooltipCard | `apps/web-frontend/src/dap/engine/*.tsx`                                             | ✅ Done                                                                        |
| useTourAction (interactive-step detection)    | `apps/web-frontend/src/dap/engine/useTourAction.ts`                                  | ✅ Done                                                                        |
| API client + React Query hooks                | `dapApi` in `api/endpoints.ts`, `dap/api/useTourProgress.ts`                         | ✅ Done                                                                        |
| Help Center integration                       | `HelpPanel.tsx` "Guided tours" section (Start/Resume/Restart)                        | ✅ Done, existing test suite updated and passing                               |
| Mount point                                   | `Layout.tsx` (`TourProvider` wraps the shell, `TourOverlay` renders once)            | ✅ Done                                                                        |
| `--z-tour` design token                       | `packages/design-tokens/tokens.css`                                                  | ✅ Done                                                                        |
| `data-tour-id` anchors                        | `GRNsPage.tsx` (`grn-create-button`), `PurchaseOrdersPage.tsx` (`po-create-button`)  | ✅ Done                                                                        |

---

## 3. FOLDER STRUCTURE (ACTUAL)

```
apps/web-frontend/src/dap/
├── content/
│   ├── schema.ts
│   ├── registry.ts
│   ├── __tests__/{schema,registry}.test.ts
│   └── tours/cross-module/purchase-to-dashboard.tour.ts
├── engine/
│   ├── TourProvider.tsx
│   ├── useTour.ts
│   ├── TourOverlay.tsx
│   ├── TourSpotlight.tsx
│   ├── TourTooltipCard.tsx
│   ├── useTourAction.ts
│   └── __tests__/{TourProvider,TourOverlay}.test.tsx
├── api/
│   └── useTourProgress.ts
└── index.ts

apps/event-service/src/api/dap.routes.ts
packages/db-client/src/schema/dap.ts
packages/db-client/migrations/0083_dap1_tour_progress_events.sql
apps/web-frontend/e2e/live-dap-tour.spec.ts   (written; not yet run to completion — see §6.3)
```

---

## 6. TESTS

### 6.1 Test Coverage

| Suite                                                                                                                                                                                                                                                                         | Result                                                                                                                                                                                                | Status  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `dap/content/__tests__/schema.test.ts`                                                                                                                                                                                                                                        | 10/10                                                                                                                                                                                                 | ✅ Pass |
| `dap/content/__tests__/registry.test.ts`                                                                                                                                                                                                                                      | 11/11                                                                                                                                                                                                 | ✅ Pass |
| `dap/engine/__tests__/TourProvider.test.tsx` (state machine only — via a bare test harness, not the real overlay components)                                                                                                                                                  | 9/9                                                                                                                                                                                                   | ✅ Pass |
| `dap/engine/__tests__/TourOverlay.test.tsx` (real component tree — mounts the actual `TourOverlay`/`TourSpotlight`/`TourTooltipCard`, drives it via real DOM clicks on real rendered nodes, including a real click on a stand-in for GRNsPage's actual "+ Create GRN" button) | 11/11                                                                                                                                                                                                 | ✅ Pass |
| `components/help/__tests__/HelpPanel.test.tsx` (updated for the new dependency)                                                                                                                                                                                               | 17/17                                                                                                                                                                                                 | ✅ Pass |
| Full `apps/web-frontend` suite                                                                                                                                                                                                                                                | 257/257 (all green on this run; `OrganizationPage.test.tsx`'s earlier failure was confirmed contention-flakiness under parallel load, not a real bug — passed both in isolation and in this full run) | ✅ Pass |
| `event-service` typecheck + lint                                                                                                                                                                                                                                              | clean                                                                                                                                                                                                 | ✅ Pass |
| `web-frontend` typecheck + lint                                                                                                                                                                                                                                               | clean (scoped to changed files — the full-repo lint run surfaces ~1100 pre-existing warnings across untouched files, see memory `preexisting_lint_debt`)                                              | ✅ Pass |

### 6.2 Real bugs found and fixed via this testing (not merely covered)

1. **Infinite render loop** — `TourProvider`'s Zustand selector was `useAuthStore((s) => s.user?.permissions ?? [])`. When `user` is `null`, `?? []` allocates a _new_ array every call; `useSyncExternalStore` sees a changed snapshot every render and loops forever ("Maximum update depth exceeded"). Fixed with a module-level `NO_PERMISSIONS` constant and moving the `??` outside the selector. Would not have fired for a normally-authenticated user (Layout only renders post-login) but was a live landmine for any future pre-auth render path. Caught by `HelpPanel.test.tsx`'s existing `user: null` fixture.
2. **Stale spotlight position** — `useTargetRect`'s effect was keyed only on the selector string. Going `Prev` back to a previously-satisfied interactive step (same selector, now-vanished element) never re-triggered the find-loop, so the ring kept rendering at its last, now-meaningless screen position. Fixed by keying the effect on `${tourId}:${stepId}` as well as the selector, and by having `measure()` explicitly clear to `null` when the element disappears rather than leaving a stale rect. Found via code review while designing the Playwright spec's interactive-step assertions, before ever running a browser.

### 6.3 Live verification — status honestly reported per this template's own "be honest" instruction

**Backend, confirmed live:** `curl -X POST http://localhost:3000/api/auth/auth/login ...` through the real
api-gateway returned a real JWT with all permissions the pilot tour's steps require (`DASHBOARD_VIEW`,
`PO_VIEW`, `GRN_CREATE`, `ITEM_VIEW`, `JOURNAL_VIEW`, `GST_VIEW`, `REPORT_VIEW`), confirmed against
`apps/tenant-service/src/rbac/role-defaults.ts` directly rather than assumed.

**A real, platform-wide bug was found and fixed as a direct result of attempting live verification:**
`packages/platform-sdk/src/http-security.ts` set `crossOriginResourcePolicy: 'same-origin'` for all 15
services. This silently makes the browser discard _any_ cross-origin fetch response regardless of correct
CORS headers — and web-frontend (`:5173`) calling api-gateway (`:3000`) is legitimately cross-origin by
this app's own architecture. Confirmed via curl-with-Origin-header (CORS headers correct, 200 OK) vs. a
real browser (login form showed "Network error", request never completed). This has almost certainly
silently blocked every browser-based `live-*.spec.ts` test that goes through api-gateway since the
2026-07-16 gateway cutover — a severe, previously-undiscovered platform issue, not specific to DAP-1.
Fixed (`'cross-origin'`, user-approved before rebuild+restart since it touches all 15 services), rebuilt
`@erp/sdk`. **This fix has not yet been confirmed against a real browser** — see below.

**What could not be completed:** immediately after restarting the ~10 locally-running dev services to pick
up the CORP fix, the host machine ran out of headroom (confirmed via `wmic OS get FreePhysicalMemory`:
~880MB–1.7GB free out of 16GB total, after a Playwright Chromium worker had already hit
`Fatal process out of memory: Zone` on an earlier run). Every subsequent service restart attempt — even a
single service in isolation, even after restarting the Redis container — either failed outright
(`ioredis`/`postgres` "Connection is closed") or logged "started" but never became reachable
(`curl` timeouts up to 10s). This is environmental resource exhaustion on the verification machine, not a
defect surfaced by this phase's code — the exact same commands worked cleanly earlier in this same
session, before the service-restart churn and a crashed browser process consumed the available memory.
`live-dap-tour.spec.ts` (3 tests: full 8-step OWNER walkthrough, ACCOUNTANT sees exactly the 3 steps their
real permissions cover, reload-mid-tour resume) is written and ready but has not been run to completion.

**UPDATE, same day, after being asked directly whether the tour was actually implemented:** the answer
above was true but underselling a real gap — every test up to this point exercised the tour's _state
machine_ (`TourProvider.test.tsx`, via a bare harness calling `useTour()` directly), never the actual
`TourOverlay`/`TourSpotlight`/`TourTooltipCard` component tree. The visual pieces had been written but
never rendered, not once, not even in jsdom. Closed the closable part of that gap immediately:
`dap/engine/__tests__/TourOverlay.test.tsx` (11 tests) mounts the real component tree and drives it with
real `fireEvent` clicks on real rendered DOM nodes — including a real click on a rendered stand-in for
GRNsPage's actual "+ Create GRN" button (same `data-tour-id` selector the real page uses), proving the
interactive-step gating (`useTourAction`'s capture-phase click listener) works against a real element, not
a mock. All 11 pass; found and fixed two test-authoring bugs along the way (an ambiguous accessible-name
query, a test that clicked past a disabled button without realizing it) — zero new bugs in the actual
component code. Full suite re-run clean: 257/257, including `OrganizationPage.test.tsx` which had failed
under parallel contention earlier and is now confirmed flaky, not broken.

**Net effect:** DAP-1's code is now verified at every layer _except_ two things that genuinely require a
real browser: real page-layout positioning (jsdom's `getBoundingClientRect` returns zeros — the spotlight
ring's math is exercised but its actual on-screen placement against real page layout is not), and the real
end-to-end backend round-trip across real page navigations (`live-dap-tour.spec.ts`, written, not yet run
to completion — same machine-memory blocker as before). Both remain this phase's honest open items — see
§12.

---

## 9. PERMISSIONS ADDED

None. Deliberately reuses existing granular `PERMISSIONS.*` constants for step-level gating (see ADR-2 in
`01_ARCHITECTURE.md`) — ` PO_VIEW`, `GRN_CREATE`, `ITEM_VIEW`, `JOURNAL_VIEW`, `GST_VIEW`, `REPORT_VIEW`,
`DASHBOARD_VIEW`, all confirmed to already exist by grepping `packages/shared-types/src/permissions.ts`
directly rather than assumed.

---

## 12. WHAT IS NOT DONE (REMAINING TODO)

| Item                                                                                       | Why Deferred                                                                                                                                                                                 | Target                                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Full in-browser click-through of `live-dap-tour.spec.ts` (3 tests, written and ready)      | Host machine ran out of memory mid-verification after a service-restart cascade; needs a retry once the machine has headroom (close other apps, or restart fewer of the 15 services at once) | Immediate follow-up, same phase — not deferred to DAP-2 |
| Confirm the CORP fix (`packages/platform-sdk/src/http-security.ts`) against a real browser | Same blocker as above                                                                                                                                                                        | Immediate follow-up                                     |
| Analytics summary dashboard (`GET` aggregate endpoint + admin page)                        | Deliberately scoped out — ADR-7, write-path only in DAP-1                                                                                                                                    | DAP-2                                                   |
| `HELP_CONTENT` migration out of `HelpPanel.tsx`'s object literal                           | Deliberately scoped out — DAP-1 proves the engine, doesn't migrate existing content                                                                                                          | DAP-2                                                   |
| POS tours                                                                                  | POS has zero baseline Help affordance today — ADR-6                                                                                                                                          | DAP-5                                                   |

---

## 13. ARCHITECTURE DECISIONS MADE IN THIS PHASE

See `ERP-PLANNING/DAP-Planning/01_ARCHITECTURE.md` ADR-1 through ADR-7 (custom engine not a library;
permission-based not role-based RBAC; event-service + direct-write tables not Kafka/outbox; git-file
content not a CMS; CustomEvent contract for interactive steps; POS out of scope; analytics dashboard
deferred). One additional decision made mid-implementation, not pre-planned:

| Decision                                                                        | Why                                                                                                                                                                                                 | Alternatives Considered                                                                                                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crossOriginResourcePolicy: 'cross-origin'` platform-wide (was `'same-origin'`) | Discovered blocking all browser-based cross-origin API access; `'same-origin'` and this app's real multi-origin architecture (frontend + gateway on different ports) are fundamentally incompatible | Leaving it and only testing via curl (rejected — would leave a severe, undiscovered platform bug in place for the sake of one phase's convenience) |

---

## 14. RISKS FOR NEXT PHASE

| Risk                                                    | Impact                                                                                                                                                         | Mitigation                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live browser verification of DAP-1 is still outstanding | The engine's core interactive/spotlight mechanics (the highest-risk, most novel part of this phase) have only been unit-tested, not watched rendering for real | Re-run `live-dap-tour.spec.ts` before starting DAP-2 content-authoring at scale — catching a rendering bug after 60 tours exist costs 60x more (see `02_ROADMAP.md`'s own stated rationale for phase ordering) |
| `drizzle-schema.ts` drift (§2.1)                        | A future `drizzle-kit generate` run would produce a confusing/wrong diff                                                                                       | Not blocking; flagged for whoever next touches the migration tooling itself                                                                                                                                    |

---

## 15. FINAL ARCHITECTURE SUMMARY

DAP-1 built a complete, working guided-tour engine from a genuine greenfield (no tour/spotlight/tooltip
primitive existed anywhere in this codebase before this phase) — content is git-versioned, Zod-validated,
and auto-discovered via `import.meta.glob`, so adding a new tour never means touching a shared file. RBAC
filtering happens at both the tour and step level using this app's real, existing permission constants,
never role names. Progress and analytics dual-write to `localStorage` (instant resume) and two new
event-service tables (cross-device source of truth), following the same direct-write pattern
`search_analytics` already proved in this codebase rather than the heavier Kafka/outbox pipeline. The one
pilot tour — Purchase Order → GRN → Stock → Accounting → GST → Reports → Dashboard — is real content
against real routes and real permissions, not placeholder text, and includes one genuine interactive step
(click the actual "+ Create GRN" button). Everything is unit-tested and two real bugs were caught and
fixed before ever reaching a browser. The single honest gap: a full live-browser click-through was
attempted, found and fixed a severe pre-existing platform bug along the way (cross-origin resource policy
blocking all browser traffic through the gateway), and then was itself blocked by the verification
machine running out of memory — a re-run once resources are available is DAP-1's one remaining task before
the phase can be marked fully, not partially, complete.

---

_Generated by: Claude Sonnet 5 | Date: 2026-07-19 | Next Phase: DAP-2 — Content Migration & Coverage Expansion (after this phase's live-verification re-run)_
