# 08 — Testing Strategy

## 1. Layers (inherited conventions, confirmed current in `00-CODEBASE-AUDIT.md` §5)

| Layer         | Tool                  | Location convention                                                                                                                                                                                                                                                | Gate                                                      |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Unit          | Vitest                | `src/domain/**/*.test.ts` or co-located `__tests__/` (this codebase uses the latter in practice — follow `apps/sales-service/src/__tests__/` as the actual precedent over the `CODING_STANDARDS.md` §6.1 `test/unit/` layout, which newer phases haven't followed) | ≥80% line coverage overall                                |
| Integration   | Vitest, real Postgres | `src/__tests__/*.integration.test.ts`, `describe.skipIf(!process.env['DATABASE_URL'])`                                                                                                                                                                             | All new API endpoints covered                             |
| E2E           | Playwright            | `apps/web-frontend/e2e/*.spec.ts`                                                                                                                                                                                                                                  | Golden-path + regression per feature                      |
| Critical-path | Vitest, 100% required | Concurrency-sensitive flows only                                                                                                                                                                                                                                   | 100% (mirrors stock-deduction/GST/credit-limit precedent) |

## 2. What counts as "critical path" for this roadmap (100% coverage required)

- Lead deduplication logic (false negatives silently lose leads; false positives silently merge
  distinct customers — both are bad in ways that don't throw errors, so they need explicit tests,
  not just happy-path coverage).
- Opportunity stage-won → Quotation creation handoff (money-adjacent, must not double-create or
  silently drop).
- Loyalty tier evaluation and redemption debit (financial-adjacent, same rigor as the existing
  double-entry-balance tests).
- Referral fraud guardrails (self-referral block, one-time-per-referee) — these are exactly the kind
  of rule that's easy to get subtly wrong and only shows up as an incident, not a test failure,
  months later.
- Portal authorization boundary (`WHERE customer_id = :self`, AR-5) — every portal route needs an
  explicit test proving customer A cannot read customer B's data by ID manipulation. This is the
  single most important test in the entire roadmap given §2.3 of the security plan.
- DLT SMS compliance gate — a test proving a non-DLT-registered promotional SMS is rejected, not
  silently sent.

## 3. Integration test additions needed

Today only `customer.integration.test.ts` covers CRM-adjacent ground. New integration suites
needed, one per major new entity, following the exact pattern in `CODING_STANDARDS.md` §6.3 (real
DB, no infra mocks):

```
apps/sales-service/src/__tests__/lead.integration.test.ts
apps/sales-service/src/__tests__/opportunity.integration.test.ts
apps/sales-service/src/__tests__/ticket.integration.test.ts
apps/sales-service/src/__tests__/journey.integration.test.ts
apps/sales-service/src/__tests__/loyalty-tier.integration.test.ts
apps/sales-service/src/__tests__/referral.integration.test.ts
apps/sales-service/src/__tests__/portal-auth-boundary.integration.test.ts
```

Each must verify: the outbox event is written in the same transaction as the business write (this
codebase's existing integration tests explicitly assert on `outboxEvents.findOne(...)` — replicate
that assertion style, don't skip it).

## 4. Playwright E2E — naming convention and scenario ownership

Per `00-CODEBASE-AUDIT.md` §5, this codebase already splits Playwright specs into `campaign-*.spec.ts`
(scoped feature regression) and `live-*.spec.ts` (full-stack smoke against live infra). This roadmap
follows the same split:

```
apps/web-frontend/e2e/leads-workflow.spec.ts          (scoped)
apps/web-frontend/e2e/pipeline-workflow.spec.ts        (scoped)
apps/web-frontend/e2e/tickets-workflow.spec.ts         (scoped)
apps/web-frontend/e2e/journey-builder.spec.ts          (scoped)
apps/web-frontend/e2e/live-crm-360.spec.ts             (live smoke, extends existing live-crm.spec.ts scope)
apps/web-frontend/e2e/live-customer-portal.spec.ts     (live smoke)
```

Exact per-feature Playwright scenarios are listed in each feature's spec in the phase docs
(`10`–`13`) — this document only sets the convention, not the scenario list, to avoid duplicating
content that belongs with each feature.

## 5. Regression protection for existing CRM E2E coverage

Four existing campaign specs (`campaign-approval-workflow.spec.ts`, `campaign-permissions.spec.ts`,
`campaign-preference-center.spec.ts`, `campaign-regression.spec.ts`) plus `live-crm.spec.ts` and
`live-sales-crm-remainder.spec.ts` already pass today. Every phase in this roadmap must re-run these
before merging — the Campaign Studio engagement upgrade (Phase 2) in particular touches
`campaignRecipients` write paths those specs may depend on, so it's the single highest-regression-risk
feature in this roadmap against existing coverage.

## 6. Coverage gate for this roadmap specifically

No new exception to the existing ≥80%/100%-critical-path CI gate (`.github/workflows/ci.yml`
`test:coverage` job) — every phase must clear it before its completion report is generated, matching
every other phase in this codebase's history.
