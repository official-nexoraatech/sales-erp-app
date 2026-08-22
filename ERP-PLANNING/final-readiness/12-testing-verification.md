# 12 — Testing & Verification Audit

## What was actually executed this session, vs. what was only read

This audit distinguishes, per the audit brief's own STATE 1/2/3 framework, between "a test file exists" (STATE 2) and "the test was run and passed" (STATE 3). Where DB/Redis infrastructure was unavailable this session, that limitation is stated explicitly rather than silently assumed away.

| Verification type                                                                    | What was done                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static test-file reading                                                             | All 8 research passes read test files directly for substance (not just counted them)                                                                                                                                                                                                                                        |
| `tsc --noEmit` / `type-check` execution                                              | Run for `@erp/crm-service`, `@erp/sales-service`, `@erp/production-service`, `@erp/tenant-service` — all 4 **PASS, 0 errors**                                                                                                                                                                                               |
| Non-DB test-suite execution                                                          | Run for `@erp/crm-service` (130 passed / 0 failed / 301 skipped) and `@erp/production-service` (128 passed / 0 failed / 56 skipped)                                                                                                                                                                                         |
| DB-gated integration test execution                                                  | **Not run** — no reachable Postgres/Redis this session. This affects confidence on: Phase 3 (HR Payroll/POS) integration tests, `business-type-capability-consistency.test.ts` (the test that would have caught the Manufacturing provisioning BLOCKER), Business Profile Foundation and RLS migration live-behavior claims |
| Live database inspection (actual row counts, actual RLS behavior under a real query) | **Not performed** — this audit is a code-level, not a runtime-database-level, verification                                                                                                                                                                                                                                  |

## Test coverage classification (sample-based, not exhaustive)

- **Unit**: capability-guard dependency-composition tests, RBAC role-route-coverage test, business-type/capability-consistency drift checks.
- **Integration (real-Postgres, `skipIf(!DB_URL)`)**: BOM explosion math and rejection paths, MRP netting, FEFO material-issue regression tests, pricing-tier resolution, valuation-FEFO consumption order, billing webhook signature verification.
- **Route-authz (401/403/200 triads)**: POS/HR_PAYROLL/INVENTORY_BATCH/BOM/MRP/Routing/Work-Center/Production-Order — every one of these route families has a dedicated authz test file, though (per `05-capability-entitlement-rbac.md`) the Manufacturing ones only test the permission half, since the capability half doesn't exist in the code they're testing.
- **End-to-end**: not independently exercised this session (no browser/Playwright run performed); prior campaign-engagement E2E specs were noted by project memory as existing-but-unrun before this audit, and that was not re-checked here.
- **Security / tenant isolation**: covered throughout `04-multitenancy-security.md`'s code-level checks; no live penetration-style test was run.

## Skipped, flaky, or pre-existing-failure tests identified

- **DB-gated tests are systematically skipped without a live database** (`describe.skipIf(!DB_URL)` pattern, used extensively and consistently across the new work). This is a deliberate, documented pattern, not silent test-rot — but it means a meaningful fraction of the newest, most safety-critical tests (including the one that would have caught the Manufacturing provisioning blocker) have very plausibly **never actually executed** in this environment. This is not a hypothetical: the specific test that should have caught `05`'s and `06`'s BLOCKER findings, `business-type-capability-consistency.test.ts`, is exactly this kind of test.
- **No new test failures were surfaced** in the 2 suites actually run — so nothing to classify against the documented pre-existing `erp-test` JWT-issuer / shared-keypair test-pollution bug class this session; its absence here is inconclusive, not evidence of a fix, since the 2 services run are not the ones that class is documented against.
- **No flaky tests were observed** in the runs performed — but 2 executions of 2 of ~19 services is not a basis for a monorepo-wide flakiness claim.

## Verdict on "do tests actually execute and pass," per the audit brief's explicit instruction not to count test files as proof

For the specific packages this audit could execute (`crm-service`, `production-service`): **yes, genuinely** — real assertions, real pass/fail results, not merely present files. For the rest of the ~19 services, and for every DB-gated integration test written as part of this initiative: **not independently confirmed this session.** The prior session-memory record for several of these (Phase 2/2B closure, F2 FEFO tests, Business Profile Foundation) claims live-DB verification occurred in earlier sessions — this audit did not re-run those and cannot independently vouch for them still passing today, though nothing found in this pass contradicts them either.

## Ranked findings

| #   | Finding                                                                                                                                                                 | Severity                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | The regression test for the plan-change entitlement bug (`05`'s BLOCKER #1) does not exist — `business-type-capability-consistency.test.ts` only exercises provisioning | HIGH (enables a blocker)                                                            |
| 2   | The regression test for the Manufacturing provisioning bug (`06`'s BLOCKER) exists but is DB-gated and plausibly never run                                              | HIGH (the test exists but its DB-gated nature is exactly why the bug wasn't caught) |
| 3   | No capability-enforcement test exists for BOM/WORK_CENTERS/PRODUCTION_ORDER/ROUTING/MRP (existing authz tests cover only the permission half)                           | Reflects `05`'s BLOCKER, not a separate gap                                         |
| 4   | DB-gated tests systematically unexecuted in this development environment, across the whole new-work surface, not just the two cases above                               | MEDIUM (structural — a live-DB CI gate would close this)                            |

## What this audit recommends on testing specifically (see also `16-final-recommendation.md`)

Running the full DB-gated integration-test surface against a live Postgres/Redis instance — even just once, before any further phase work — would very plausibly surface both of this audit's provisioning/entitlement BLOCKERs mechanically, since the tests to catch them already exist and are well-written; they simply have not been executed. This is a lower-cost, higher-confidence path to closing 2 of the 3 blockers than any new code review would be.
