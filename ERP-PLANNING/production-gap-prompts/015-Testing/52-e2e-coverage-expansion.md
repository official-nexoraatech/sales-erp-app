# [PG-054] E2E Coverage Expansion Beyond Mocked-API Smoke Suite

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Testing
**Priority:** Medium
**Complexity:** L — new full-stack E2E tier (real Postgres/Redis/Kafka), four business-workflow suites, plus a second frontend (pos-frontend) getting E2E for the first time.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `apps/web-frontend` (e2e/), `apps/pos-frontend` (new e2e/), `.github/workflows/ci.yml`

---

## Overview

- **Business objective:** The only Playwright suite in the repo proves that the Global Search command palette opens, calls an API, and navigates — it says nothing about whether a user can actually create an invoice, receive a purchase, run payroll, or file a GST return end-to-end. Those four workflows are the ones with the most active bug-fixing happening elsewhere in this backlog (RBAC drift, GST bucket computation, payroll deductions, purchase GRN flows) — regressions there currently have no automated end-to-end guard. A backend unit test can pass while the page that calls it is broken (this has already happened at least once in this project's history — see `[[customer_creation_was_broken]]` in project memory, a 100%-broken create flow that unit tests didn't catch because the bug was in field-name mismatches between frontend and backend, not in either side's own logic).
- **Current implementation:** `apps/web-frontend/e2e/global-search.spec.ts` (117 lines) — one `test.describe` block, two tests, covering only the command palette. `apps/web-frontend/playwright.config.ts` runs a single `chromium` project against the real Vite dev server (`pnpm dev`, port 5173) with `page.route()` mocking every HTTP call at the network boundary (`**/auth/login`, `**/users/me`, `**/saved-searches`, `**/search?**`) — there is no real backend, no Postgres, no Elasticsearch, no Kafka in this suite at all. `apps/pos-frontend` has a `src/__tests__/` directory of Vitest unit/component tests (confirmed via `Glob` — no `e2e/` directory, no `playwright.config.ts` anywhere under `apps/pos-frontend`) — it has **zero** E2E coverage of any kind today.
- **Current architecture:** In CI (`.github/workflows/ci.yml`), the `e2e` job (lines 145-178) runs `needs: [lint, type-check]` — deliberately not `needs: [test]`, since it doesn't need the Postgres/Redis service containers the `test` job spins up. It installs Playwright + Chromium, runs `pnpm test:e2e` inside `apps/web-frontend`, and uploads the HTML report only `if: failure()`. The `test` job (lines 75-139) already stands up real `postgres:16-alpine` and `redis:7-alpine` service containers for backend integration tests — that infrastructure exists and works today, it is just not reused by the `e2e` job.
- **Current limitations:** Zero coverage of: order-to-cash (quote → invoice → payment → GST ledger posting), procure-to-pay (PO → GRN → supplier payment → accounting), payroll cycle (attendance → payroll run → payslip → accrual journal), and GST filing cycle (GSTR-1 → GSTR-3B → GSTR-9). Zero E2E coverage of `apps/pos-frontend` at all — no smoke test even exists to catch a broken checkout screen. The one existing suite mocks the API, so it cannot catch backend contract drift (a changed response shape, a renamed field) — only frontend-side wiring bugs.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `apps/web-frontend/playwright.config.ts` — the `webServer` block (`pnpm dev`, `reuseExistingServer: !CI`), `fullyParallel`, `retries` on CI — keep this config as the base for the mocked-API smoke tier; a new full-stack tier gets its own config file, not a rewrite of this one.
  - The `mockJson()` / `fakeJwt()` / `login()` helpers in `global-search.spec.ts` — the CORS-preflight-handling and `apiClient`'s `{ data: ... }` response-wrapping gotchas they encode (see the file's own header comment) apply to every future mocked-API spec; extract them into a shared `apps/web-frontend/e2e/helpers.ts` rather than re-deriving them per new spec file.
  - The `test` job's Postgres/Redis service-container pattern in `ci.yml` (lines 78-104) — reuse verbatim for the new full-stack E2E tier rather than inventing a different container setup.
  - `registerHealthRoute` (`@erp/sdk`) on every backend service, and the existing seed/fixture patterns used by backend integration tests (`apps/*/src/__tests__/`) — reuse for full-stack test data setup instead of writing new seed SQL from scratch.
- **What should never be modified:** The existing `global-search.spec.ts` test bodies and `playwright.config.ts` — they are a working, passing suite; this package adds alongside them, not on top of them.
- **Prior related work:** `GLOBAL-SEARCH_COMPLETION.md` documents why the existing suite mocks the API ("no docker-compose'd Postgres/Elasticsearch/Kafka stack in CI for this suite to hit"). `[[playwright_first_e2e_suite_gotchas]]` (project memory) documents the CORS/response-wrapping gotchas already solved once — do not rediscover them. `[[web_frontend_test_infra_added]]` confirms Vitest+RTL unit-test infra exists separately (`pnpm --filter @erp/web-frontend test`) and is not what this package touches (unit tests are a different tier).

## Architecture

- Two E2E tiers, not one:
  1. **Mocked-API smoke tier (existing, extend in place):** stays fast, stays in the `e2e` CI job that runs on every PR (`needs: [lint, type-check]`, no DB). Good for pure frontend-wiring regressions (routing, form validation, permission-gated UI, focus management) on the areas of the app under active churn.
  2. **Full-stack workflow tier (new):** a second Playwright project/config (`apps/web-frontend/e2e-full/` or a `playwright.full.config.ts` alongside the existing one) that runs against real backend services + real Postgres/Redis (Kafka only if a workflow's assertion genuinely depends on an async outbox-relayed side effect, e.g. confirming a journal entry landed in `accounting-service` after invoice confirmation — otherwise skip Kafka to keep the tier fast). This tier is **not** run on every PR; run it on a schedule (nightly) and on `main`/tag pushes, given its cost (spinning up several real services) — mirror the "expensive tier runs less often" pattern already established by `security-scan`/`build` running only on non-PR events in this same `ci.yml`.
- Component interaction/data flow for the full-stack tier, per workflow:
  - **Order-to-cash:** Playwright drives `web-frontend` at `/sales/invoices` (real `sales-service`) → creates + confirms an invoice → asserts the invoice list reflects `CONFIRMED` status → asserts (via a direct DB read or an `accounting-service` API call, not just UI) that a journal entry was posted. This exercises the real saga/outbox path this repo already relies on (see `[[es24_saga_orchestrator_design]]`), which the mocked tier structurally cannot.
  - **Procure-to-pay:** `/purchase/orders` → create PO → `/purchase/grns` → receive against it → `/purchase/payments` → record supplier payment → assert stock increased (`inventory-service`) and a GRNI-clearing journal posted (`accounting-service`).
  - **Payroll cycle:** `/hr/payroll` → run payroll for a period → assert payslips generated → assert an accrual/clearing journal posted to `accounting-service` (per the existing `hr-service → accounting-service` event flow documented in the Master Roadmap's dependency graph).
  - **GST filing cycle:** `/gst/gstr1` → generate return from confirmed invoices → `/gst/gstr3b` → assert computed liability → `/gst/gstr9` → assert annual rollup. This directly exercises the GST module several other packages in this backlog (PG-038, PG-039, PG-040) are actively changing — prioritize this workflow first if only one can be built in a single session, since it has the most concurrent churn.
- **Prioritization order** (given Complexity L and that this is one session's worth of scope at most for one workflow): GST filing cycle first (highest concurrent-churn area per PG-038/039/040), then order-to-cash (highest business criticality), then procure-to-pay, then payroll cycle — build one workflow's full-stack spec per session rather than attempting all four at once.
- **pos-frontend E2E:** confirmed via `Glob`/`find` — no `playwright.config.ts`, no `e2e/` directory anywhere under `apps/pos-frontend` today; only `src/__tests__/` Vitest unit tests exist (per `[[offline01_completion_2026_07_05]]` / `[[offline02_completion_2026_07_05]]`, those tests are "pos-frontend's first tests ever," and none of them are Playwright/E2E). This package adds a first pos-frontend Playwright config + a single smoke spec (mocked-API tier only, mirroring `web-frontend`'s starting point) covering the quick-sale checkout flow — the single most business-critical POS path, and the one with the most offline/idempotency work already landed on it (`[[offline02_completion_2026_07_05]]`, `[[offline05_completion_2026_07_05]]`). Full-stack POS E2E (with real offline/sync assertions) is out of scope for this package — flag as a natural follow-up, not silently expand scope to include it.

## Database Changes

Not applicable — no schema change. Full-stack E2E tier uses migrations already applied via the existing `pnpm --filter @erp/db-client migrate` (or equivalent) tooling the `test` CI job already runs before backend integration tests.

## Backend

- No backend application code changes. This package's only "backend" touch is test fixture/seed data: a minimal, idempotent seed script (new file, e.g. `apps/web-frontend/e2e-full/fixtures/seed.ts`) that creates one tenant, one branch, one warehouse, a handful of items/customers/suppliers/employees — reuse existing seed patterns from backend integration tests rather than writing raw SQL inserts from scratch.
- If a workflow assertion needs to confirm an async side effect (e.g. journal posting after invoice confirm), prefer polling the target service's real REST API (`GET /api/v2/journals?...`) over reading the DB directly — keeps the test black-box and consistent with how a real API consumer would observe the result.

## Frontend

- New spec files only, no application code changes:
  - `apps/web-frontend/e2e/helpers.ts` — extracted `mockJson`/`fakeJwt`/`login` helpers (refactor out of `global-search.spec.ts`, keep that file's own tests passing unchanged).
  - `apps/web-frontend/e2e-full/gst-filing-cycle.spec.ts`, `order-to-cash.spec.ts`, `procure-to-pay.spec.ts`, `payroll-cycle.spec.ts` — one per workflow, full-stack tier, built incrementally per the prioritization order above.
  - `apps/web-frontend/playwright.full.config.ts` — new config, `testDir: './e2e-full'`, points `baseURL` at the real dev server same as today, but the `webServer` step in CI additionally starts the real backend services (or a `docker compose` subset) before Playwright runs.
  - `apps/pos-frontend/playwright.config.ts` (new) + `apps/pos-frontend/e2e/checkout-smoke.spec.ts` (new) — mirrors `web-frontend`'s existing mocked-API pattern exactly (same CORS/response-wrapping helpers, extracted to a shared location if practical, e.g. a small shared `@erp/e2e-test-utils` internal package, or duplicated once with a comment pointing at the web-frontend original — duplicating once is acceptable per "Simplicity First," a shared package is only justified if a third consumer appears).

## API Contract

Not applicable — this package adds no new endpoints; the full-stack tier calls existing REST endpoints already documented in each service's own routes.

## Multi-Tenant Considerations

- Full-stack E2E fixtures must create their own isolated tenant per test run (not reuse a shared seeded tenant) to avoid cross-run data pollution and false negatives from a previous run's leftover state — follow the same `tenant_id`-scoped-everything convention every other part of this app already uses.

## Integration

- **`.github/workflows/ci.yml`** — extend the existing `e2e` job (unchanged) to also run the new mocked-API `pos-frontend` smoke spec; add a **new** job, e.g. `e2e-full`, gated `if: github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/v')` (not on every PR) with its own Postgres/Redis/service-container setup mirroring the `test` job, plus `pnpm --filter <service> dev`/`start` for the services each workflow spec needs (not all 14 — only the ones the given workflow spec touches).
- **`apps/web-frontend`, `apps/pos-frontend`** — spec/config files only.
- **`sales-service`, `purchase-service`, `hr-service`, `gst-service`, `accounting-service`, `inventory-service`** — the full-stack tier's specs call these services' real APIs; no code changes to any of them.

## Coding Standards

- Reuses the existing Playwright + `page.route()` mocking convention for the smoke tier (no new mocking library). The full-stack tier introduces no new test framework either — still Playwright, just pointed at real services instead of mocks. Match `global-search.spec.ts`'s existing comment-heavy style explaining non-obvious waits/races (e.g. the documented focus-race and deferred-`setTimeout` gotchas) — future specs will hit similar races and should document them the same way rather than adding blind `waitForTimeout` calls.

## Performance

- The full-stack tier is deliberately not run per-PR (cost of spinning up multiple real services) — run nightly + on `main`/tag pushes only, per the Architecture section. Keep the mocked-API tier's per-PR runtime unchanged (currently two tests, sub-minute).

## Security

Not applicable — no new attack surface; test-only fixtures use throwaway tenant/user credentials scoped to the CI-ephemeral database, never a production or shared staging database.

## Testing

- This package _is_ test infrastructure. Concretely:
  - `apps/web-frontend/e2e/helpers.ts` (new, extracted).
  - `apps/web-frontend/e2e/pos-checkout-smoke.spec.ts` is wrong location — correct path: `apps/pos-frontend/e2e/checkout-smoke.spec.ts` (new).
  - `apps/web-frontend/e2e-full/gst-filing-cycle.spec.ts` (new, build first).
  - `apps/web-frontend/e2e-full/order-to-cash.spec.ts`, `procure-to-pay.spec.ts`, `payroll-cycle.spec.ts` (new, subsequent sessions).
  - `apps/web-frontend/playwright.full.config.ts`, `apps/pos-frontend/playwright.config.ts` (new configs).

## Acceptance Criteria

- [x] `apps/pos-frontend` has a `playwright.config.ts` and at least one passing E2E spec (`checkout-smoke.spec.ts`) runnable via `pnpm --filter @erp/pos-frontend test:e2e`. Done 2026-07-11 — verified via `pnpm --filter @erp/pos-frontend test:e2e` from repo root, passing, stable across `--repeat-each=3`.
- [x] `apps/web-frontend/e2e/helpers.ts` exists; `global-search.spec.ts` is refactored to import from it and its existing two tests still pass unchanged. Done 2026-07-11 — also refactored `mobile-responsive-smoke.spec.ts` (PG-053, landed after this doc was written) onto the same helpers; all 8 web-frontend e2e tests pass. See `IMPLEMENTATION-NOTES.md`'s "PG-054" entry.
- [ ] At least the GST filing cycle full-stack spec exists, runs against real Postgres/Redis + `gst-service`/`sales-service`, and passes locally with `docker compose` services up. Deferred to Session 2 per this doc's own "Next Session Plan" — not attempted this session.
- [ ] A new `e2e-full` CI job exists in `ci.yml`, gated to `main`/tag pushes (not every PR), and is green on at least one real run. Deferred to Session 2, same as above.
- [ ] The existing per-PR `e2e` job's runtime does not measurably regress (still completes in under ~2 minutes). Not independently measured in real CI this session — the added pos-frontend suite is a single ~1s test reusing the same Playwright browser install, so the expected marginal cost is one extra dev-server boot (~a few seconds), not a new browser download; worth confirming on the first real CI run.

## Deliverables

- **Files to create:** `apps/web-frontend/e2e/helpers.ts`, `apps/web-frontend/e2e-full/gst-filing-cycle.spec.ts` (+ 3 follow-on specs in later sessions), `apps/web-frontend/playwright.full.config.ts`, `apps/web-frontend/e2e-full/fixtures/seed.ts`, `apps/pos-frontend/playwright.config.ts`, `apps/pos-frontend/e2e/checkout-smoke.spec.ts`.
- **Files to modify:** `apps/web-frontend/e2e/global-search.spec.ts` (refactor to use extracted helpers), `.github/workflows/ci.yml` (new `e2e-full` job; extend `e2e` job or add a sibling for pos-frontend).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** listed above under Testing.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/web-frontend` has exactly one Playwright spec, `e2e/global-search.spec.ts`, testing the Ctrl+K command palette against a real dev server with every HTTP call mocked via `page.route()`. `apps/pos-frontend` has Vitest unit tests only, zero E2E. CI's `e2e` job runs the web-frontend suite on every PR/push, gated only on `lint`+`type-check` (no DB needed since everything is mocked).

**Current Objective:** Add a full-stack E2E tier (real Postgres/Redis/backend services) covering four business workflows — prioritize GST filing cycle first (most concurrent churn from PG-038/039/040), then order-to-cash, procure-to-pay, payroll cycle — plus a first-ever E2E smoke spec for `pos-frontend` (checkout flow, mocked-API tier matching web-frontend's existing pattern).

**Architecture Snapshot:**

1. The existing suite mocks `**/auth/login`, `**/users/me`, `**/saved-searches`, and any endpoint under test — CORS preflight (OPTIONS) must be answered manually since dev-server and mock-service ports differ.
2. `apiClient` unwraps every response as `data.data` — mocked responses must be wrapped `{ data: ... }` or assertions silently see `undefined`.
3. The `test` CI job already runs real `postgres:16-alpine`/`redis:7-alpine` containers for backend integration tests — the new full-stack E2E tier should reuse that same container pattern, not invent a new one.
4. `registerHealthRoute` (`@erp/sdk`) gives every service a real `/health` check useful for "is the stack up yet" readiness polling in the new tier's setup.

**Completed Components:** The mocked-API smoke tier (`global-search.spec.ts` + `playwright.config.ts`) — do not rewrite, only extract shared helpers from it.

**Pending Components:** Full-stack `pos-frontend` E2E with real offline/sync assertions — explicitly out of scope for this package; only a mocked-API checkout smoke spec is in scope here.

**Known Constraints:** No live Docker/Postgres stack may be available in every dev session (see `[[es24_no_live_db_available]]`) — if unavailable, build the spec files and config against best-known API shapes, and flag "requires a live stack run before merge," don't claim green without one.

**Coding Standards:** Playwright + `page.route()` for the mocked tier, no new mocking library; full-stack tier still Playwright, no new framework. Match the existing spec's comment style for documenting UI races/timing gotchas.

**Reusable Components:** `mockJson`/`fakeJwt`/`login` helpers in the existing spec (extract, don't duplicate blindly); the `test` CI job's Postgres/Redis service-container block.

**APIs Already Available:** every service's real REST API (sales, purchase, HR, GST, accounting, inventory) — the full-stack tier calls these directly, no new endpoints needed.

**Events Already Available:** the outbox/Kafka flows already wired for invoice confirmation → accounting posting, GRN → accounting posting, payroll → accrual journal — full-stack specs assert on their _outcomes_ via REST polling, not by touching Kafka directly.

**Shared Utilities:** none new required; reuse `@erp/sdk`'s health-route convention for stack-readiness polling if needed.

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** each full-stack test run must create/seed its own isolated tenant, never reuse a shared fixture tenant across parallel test runs.

**Security Rules:** Not applicable — test-only throwaway credentials in an ephemeral CI database.

**Database State:** Full-stack tier assumes migrations already applied (same tooling the `test` job uses today).

**Testing Status:** One passing mocked-API spec exists (`global-search.spec.ts`); zero full-stack E2E; zero pos-frontend E2E of any kind.

**Next Session Plan:** Too large for one session end-to-end. Session 1: extract helpers, build pos-frontend's first smoke spec (small, self-contained). Session 2: full-stack tier scaffolding (config, CI job, seed fixtures) + GST filing cycle spec. Sessions 3-5: order-to-cash, procure-to-pay, payroll cycle specs, one per session.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/015-Testing/52-e2e-coverage-expansion.md` and implement PG-054. Start with whichever sub-scope is listed as incomplete in this file's Deliverables/Acceptance Criteria — re-verify against the live repo first (`Glob` for `apps/pos-frontend/e2e/**`, `apps/web-frontend/e2e-full/**`) since concurrent sessions may have already landed part of this."
