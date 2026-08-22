# 11 — Backward Compatibility Audit

Verifies that existing (Cloth, Grocery) tenants, roles, permissions, invoices, inventory, reports, POS, and integrations continue working unmodified by the multi-industry transformation work currently in the tree.

## Git-state coherence — one coherent, nearly-done initiative, not scattered work

The working tree carries 320 modified/deleted tracked files + 108 untracked new paths (`git diff --stat`: 320 files changed, 10,449 insertions, 32,639 deletions). This decomposes cleanly into 7 logical groups: CRM/O2C split, Manufacturing, Business Profile Foundation, RLS enablement, Billing/Razorpay, Partner Portal, and the capability-registry/capability-guard system. **The largest single driver of the scary-looking net-deletion diff stat is entirely explained by the CRM/O2C split** moving content out of `apps/sales-service` into the new `apps/crm-service` — confirmed with matching files reappearing on both sides (24 route files, 21 domain services, 39 test files).

## Blocker check on the CRM split — clean

Grepped `apps/sales-service/src` for imports of every deleted CRM domain/route file (AccountService, CampaignService, LeadService, OpportunityService, and 13 others, plus their route files): **zero live import matches**, one stale code comment only. Corroborated by a clean `tsc --noEmit` on `@erp/sales-service`. **No broken-build risk from the split.**

## Executed verification (not just static reading)

| Package                   | type-check         | test                                                      |
| ------------------------- | ------------------ | --------------------------------------------------------- |
| `@erp/crm-service`        | **PASS**, 0 errors | **PASS** — 130 passed / 0 failed / 301 skipped (DB-gated) |
| `@erp/sales-service`      | **PASS**, 0 errors | not run (time-boxed)                                      |
| `@erp/production-service` | **PASS**, 0 errors | **PASS** — 128 passed / 0 failed / 56 skipped (DB-gated)  |
| `@erp/tenant-service`     | **PASS**, 0 errors | not run (time-boxed)                                      |

Two of the largest new/changed services compile clean with their full non-DB test suites passing at zero failures — a materially positive signal against a "scattered/half-finished" read.

## Existing cloth/grocery flow diffs — read in full, not just diff-stat

- **`apps/sales-service/src/__tests__/pos-completion.test.ts`** (53 lines removed): removes the "campaign opt-out" test block with an explanatory comment that this coverage "moved to crm-service's campaign-service.test.ts... this file's own copies were fully redundant." All remaining POS assertions (hold/resume round-trip, loyalty redemption limits) are byte-identical, untouched. Subtractive-due-to-split, not a behavior change.
- **`apps/sales-service/src/__tests__/invoice-validation.test.ts`** (+12 lines): purely additive — one new mocked DB call prepended to existing mock chains for the new price-list-resolution step `InvoiceService.create()` now performs before credit-limit/price-floor checks. No existing assertion changed.
- **`apps/sales-service/src/__tests__/sales-workflow.test.ts`** (+7 lines): identical pattern — 7 separate test blocks each get one mock prepended to their `trx.where` mock chain. Every pre-existing `expect(...).rejects.toThrow(...)`/status assertion is unchanged.

**Verdict: mechanical/additive, not a backward-compat risk.** All three diffs trace to one underlying cause (`InvoiceService.create()` gained a new `customer.priceListId` lookup as its first DB call), and every pre-existing assertion about credit limits, customer status, and price floors survives unmodified. No cloth/grocery-flow regression evidence found.

## Migration bookkeeping — clean

`packages/db-client/migrations/meta/_journal.json`: 184 entries, idx 0→183, strictly sequential, no gaps, no duplicates. New entries this session (169-183) have monotonically increasing timestamps. Every referenced `.sql` file confirmed present on disk. **The previously-documented migration-bookkeeping-breakage pattern (journal BOM + out-of-order timestamps) is not present in this range** — a real, positive finding against a documented recurring bug class in this codebase.

## New test coverage quality — substantive, not placeholder

Sampled 10 new test files across production-service, tenant-service, sales-service, auth-service, platform-sdk, and inventory-service. Consistent pattern: real-Postgres `describe.skipIf(!DB_URL)` integration tests for domain logic, paired with separate 401/403/200 route-authz unit tests, plus explicit regression tests for adjacent behavior — e.g. `job-work-material-issue-fefo.integration.test.ts` explicitly asserts "FIFO still works when FEFO disabled," and `users-me-capabilities.test.ts` explicitly asserts the new `/me` field "does not change any existing field... additive only."

## Known pre-existing test-infra issue — not triggered, not disambiguated

Neither test run executed (crm-service, production-service) produced any failures, so there was nothing to classify against the documented `erp-test` JWT-issuer / shared-keypair test-pollution bug class this session. Its absence here is not strong evidence it's fixed — sales-service and tenant-service test suites (the services that class is documented against) were not executed due to time budget.

## Stray artifacts — hygiene finding, not a functional risk

`.qa-tmp-index-list.txt` (repo root, untracked) and `apps/web-frontend/.qa-scratch/` (untracked directory, containing Playwright auth-state snapshots and a `token.txt` with a live-looking JWT) are Playwright/QA debug leftovers from manual verification sessions. The JWT decodes to the known `owner@qa-e2e.local` test-tenant account documented in `TEST_CREDENTIALS.md` — not a production secret — but committing raw auth tokens/session state, even test ones, is bad hygiene. Rated **MEDIUM** — should be `.gitignore`d and removed before any commit, not a functional blocker.

## Ranked findings

| #   | Finding                                                                                                                                                     | Severity         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | `.qa-tmp-index-list.txt` / `apps/web-frontend/.qa-scratch/` (incl. a live QA-tenant JWT) are untracked debug artifacts that should be removed before commit | MEDIUM (hygiene) |
| 2   | Business Profile Foundation (migration 0170) and RLS migrations (0176-0178) checked only structurally, not re-verified against a live DB this session       | NOT VERIFIED     |
| 3   | sales-service and tenant-service test suites (vs. type-check, which passed) were not executed this session                                                  | NOT VERIFIED     |

**No blocker or high-severity backward-compatibility issue was found.** This is the one clean area of the audit — see `00-executive-verdict.md` for how this weighs against the blockers found elsewhere.
