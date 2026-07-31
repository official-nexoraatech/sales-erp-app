# CRM-ROADMAP Phase 3, Feature 4 — Mobile CRM — Completion Report

**Date:** 2026-07-30
**Status:** Complete — E2E live-run verification now passing (see Verification section; an
earlier version of this report said this was blocked, which was a misdiagnosis, corrected below).

## Summary

A responsive-first extension of `web-frontend`'s existing CRM pages, per the roadmap's own
explicit call for a PWA over a new native app — this codebase has zero mobile infrastructure
today and both frontends are Vite SPAs, so a new framework/app would be unjustified scope.

- **Pipeline Kanban (`PipelineKanbanPage.tsx`)** — the one page that genuinely needed a layout
  change: below `md`, stages now stack into a full-width vertical list (`grid grid-cols-1 gap-3
md:flex md:gap-3 md:overflow-x-auto`) instead of a horizontally-scrolling row of fixed `w-72`
  columns. At `md+` the layout is byte-for-byte the same as before this feature. A phone-width
  Kanban board squeezed into ~1.3 columns is the roadmap's own named "unusable squeezed board"
  edge case — a stacked list needs no horizontal gesture at all.
- **Tap-to-advance on both Kanban boards** (Pipeline and Leads) — native HTML5 drag-and-drop
  (`draggable`/`onDragStart`/`onDrop`) has **no touch equivalent**; a rep on a phone previously
  had _no way at all_ to move a deal or lead between stages. Both boards now also carry a native
  `<select>` per card (works identically with touch, mouse, and keyboard) that calls the exact
  same stage-change mutation the drag path already used — refactored `PipelineKanbanPage`'s
  `onDrop` into a shared `moveToStage(opp, stage)` so both paths share one code path, not two.
- **Leads Kanban (`LeadsKanbanPage.tsx`)** — layout was already fine (`grid-cols-1 md:grid-cols-3`
  already stacks without horizontal scroll); only needed the same tap-to-advance `<select>`.
- **Ticket inbox (`TicketsPage.tsx`)** — needed **no changes at all**. It already renders through
  `ERPDataGrid`, which ships a real, viewport-gated "stacked-card hybrid" mobile layout (verified
  by reading the component, not assumed from its own comment) — confirmed via code review, not
  just taken on faith.
- **Customer 360 (`CustomerViewPage.tsx`)** — already covered by the pre-existing PG-053
  responsiveness smoke test; this feature's own Phase 3 Feature 1 AI cards (churn/next-best-
  action/recommendations) are new stacked full-width blocks above the tabs, following the exact
  same pattern the health-score/loyalty-tier strips already used, so no new responsive work was
  needed there either — just new test coverage (see Testing).
- **PWA installability**: `public/manifest.webmanifest` (name/icons/start_url=`/dashboard`/
  standalone display) + `public/sw.js`, a deliberately minimal service worker — enough for a
  browser's install-prompt eligibility check and a basic "app shell still opens if the network is
  down" fallback, explicitly **not** an offline-data-sync layer (that's Phase 4's Field Sales
  feature — a much larger scope: real request queuing and conflict resolution). Runtime-caches
  whatever it fetches rather than precaching a build-hashed asset list, so it needs no
  `vite-plugin-pwa`/build-tool integration — a smaller footprint, no new dependency.

## Decisions / deviations (flagged during implementation, not silently decided)

1. **No PNG/raster icon set generated.** The manifest references the existing `favicon.svg` with
   `"purpose": "any"` — modern Chromium supports SVG manifest icons, but this is a known,
   documented limitation (some older/other browsers may decline the install prompt without a
   raster icon) rather than a silently-assumed non-issue. Generating a proper icon set needs
   actual image-asset tooling this session didn't have; flagged as a follow-up, not fabricated.
2. **The tap-to-advance `<select>` is shown at every breakpoint, not hidden on desktop.** The
   roadmap's edge case only asks for a _small-screen alternative_ to drag-and-drop, but a native
   select is cheap, accessible (keyboard + screen-reader users on desktop had no way to change
   stage without a mouse either, before this), and doesn't meaningfully clutter the existing
   desktop card design — so it was kept universal rather than gated behind another breakpoint
   check, avoiding an extra conditional for no real benefit.
3. **`vite-plugin-pwa` was deliberately not added.** It's the more "correct" way to build a
   precached PWA shell long-term, but pulling in a new build-time dependency and verifying it
   against a full production build (this session only ran the dev server) is a bigger, riskier
   change than this pass's actual requirement — the roadmap's own Playwright scenario for this is
   explicitly conditional ("if implemented"), and the Acceptance Criteria itself only requires
   "meaningfully usable from a phone browser," not app-store-grade installability.

## Acceptance Criteria

- [x] A rep can meaningfully use Customer 360, Pipeline, and Tickets from a phone browser —
      covered by the layout changes above; Tickets required none, Pipeline required a real
      layout change, Customer 360 already worked.
- [x] Pipeline's Kanban degrades to a usable list view on narrow viewports rather than an
      unusable squeezed board — covered directly (breakpoint change, described above).
- [~] PWA install prompt and offline-shell behavior "(if implemented)" — implemented at a basic
  level (manifest + minimal SW); not verified against a live install-prompt event this
  session (a real install-prompt requires a packaged/HTTPS deploy, not just the dev server).

## Verification performed this session

- `pnpm --filter web-frontend type-check` — clean.
- `pnpm --filter web-frontend lint` — 0 new errors (only the same pre-existing-style warnings
  already present throughout this codebase).
- `pnpm --filter web-frontend test` — **430/430 passing** (vitest component/unit suite —
  unaffected by the E2E blocker below, since these don't exercise a live login flow).
- **Extended `e2e/mobile-responsive-smoke.spec.ts`** with 4 new test blocks (Customer 360 AI
  cards, Pipeline Kanban, Leads Kanban, Ticket inbox) — `npx playwright test ... --list` confirms
  all 10 tests (6 pre-existing + 4 new) parse and register correctly.
- **Live E2E run initially failed for every test in the file** — including 3 pre-existing,
  entirely-untouched ones (Dashboard, Customer detail, Leave approvals) — at the shared `login()`
  helper with "Network error." Initially misdiagnosed as a concurrent session's in-progress auth
  work; on investigation (prompted by the user, see that session's own findings) this turned out
  to be **my own uncommitted work from earlier in this same long session** — completed fixes for
  `API-GATEWAY-AUDIT-2026-07-23.md` and `WEB-FRONTEND-AUDIT-2026-07-24.md` — not a conflicting
  actor. The real root cause: that audit work moved the access token out of `localStorage` and
  added `credentials: 'include'` to every auth-service fetch (refresh now goes via an httpOnly
  cookie) — a credentialed request can never be paired with a wildcard
  `Access-Control-Allow-Origin: '*'`, which is exactly what `e2e/helpers.ts`'s `mockJson()` always
  sent, so every login attempt was rejected by the browser's own CORS enforcement before the app
  ever saw the mocked response.
- **Fixed in `e2e/helpers.ts`**: `mockJson()` now echoes the request's actual `Origin` header and
  adds `Access-Control-Allow-Credentials: true`; added a `mockRawJson()` variant for `/auth/refresh`
  specifically (that one endpoint returns tokens unenveloped, unlike every other mocked route);
  `login()` now also mocks `/auth/refresh` (needed because `page.goto()` performs a full page
  reload, re-mounting `AuthBootstrap`, which silently re-derives the access token from the refresh
  cookie on every such reload now that it's no longer persisted).
- **Two more real gaps found and fixed while getting the suite green, all in test code, not
  production code**: (1) `mobile-responsive-smoke.spec.ts`'s pre-existing customer/leave mocks
  were anchored to direct per-service ports (`localhost:3013`/`3021`) from before the 2026-07-16
  gateway cutover — every service call now goes through the gateway on port 3000, so those mocks
  had been silently dead for a while; (2) `DashboardPage.tsx` reads a `pendingDeliveries` alerts
  sub-field, plus separate headcount/pending-leave-approval queries, that the pre-existing
  dashboard mock never covered — an omission crashes the page's error boundary. All fixed by
  updating the test's own mocks, not the application code (the app's behavior — assuming a fully-
  populated alerts response — is correct and unchanged).
- **Full mobile-responsive-smoke.spec.ts run, serial (`--workers=1`): 10/10 passing** — the 6
  pre-existing tests plus this feature's 4 new ones (Customer 360 AI cards, Pipeline Kanban, Leads
  Kanban, Ticket inbox). Under Playwright's default full parallelism, 1-2 tests occasionally fail
  from resource contention against the single local dev server (the same class of flakiness as
  [[turbo_parallel_test_false_failures]]) — not a logic issue, confirmed by the serial run.
- Also ran `signup.spec.ts` (uses the same shared `login()`/`mockJson()`) — passes. Two unrelated,
  pre-existing failures were found in other specs while spot-checking (`global-search.spec.ts`: a
  fixed-position onboarding-checklist widget intercepts a click target; `invoices-workflow.spec.ts`:
  a branch/warehouse dropdown never gets populated) — both pre-date this session's work and are
  out of scope for this feature; not fixed, flagged for a separate pass.

## Files touched

- `apps/web-frontend/src/pages/crm/PipelineKanbanPage.tsx` — mobile stacking breakpoint,
  `moveToStage()` refactor, tap-to-advance `<select>`.
- `apps/web-frontend/src/pages/crm/LeadsKanbanPage.tsx` — tap-to-advance `<select>`.
- `apps/web-frontend/public/manifest.webmanifest` — new.
- `apps/web-frontend/public/sw.js` — new.
- `apps/web-frontend/index.html` — manifest link, theme-color, apple-touch-icon.
- `apps/web-frontend/src/main.tsx` — service worker registration.
- `apps/web-frontend/playwright.config.ts` — `serviceWorkers: 'block'`.
- `apps/web-frontend/e2e/helpers.ts` — CORS/credentials fix, `mockRawJson()`, `/auth/refresh` mock.
- `apps/web-frontend/e2e/mobile-responsive-smoke.spec.ts` — 4 new test blocks + `PERMISSIONS`
  additions; fixed stale per-service-port mock anchors; added missing dashboard mocks.

## What is not done (remaining TODO)

| Item                                                      | Why deferred                                                                                                       | Target                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Real PNG/raster PWA icon set                              | No image-asset tooling available this session; SVG-only icon is a documented, flagged limitation, not a silent gap | Whenever real icon assets are produced                           |
| Precached, build-integrated PWA shell (`vite-plugin-pwa`) | Deliberately deferred — bigger scope than this pass's actual requirement (see Decisions #3)                        | Only if the current minimal runtime-cache SW proves insufficient |
| Manual on-device (real phone) verification                | Not possible in this session's environment                                                                         | Before this feature ships to a real tenant                       |

## Deployment Checklist

- [ ] No new database migrations.
- [ ] No new environment variables.
- [ ] Confirm the new `public/sw.js`/`manifest.webmanifest` are actually served correctly by
      whatever reverse proxy/CDN fronts production `web-frontend` (some proxies rewrite/strip
      `.webmanifest` MIME types) — not verified against a real deployment this session.
