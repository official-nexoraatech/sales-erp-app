# 02 — Business Requirements

## 1. Why this phase, why now

The user selected this from `41-phase-2b-closure-review.md` §14.3's three-option list, after `phase-03-hr-payroll-pos-enforcement` was planned but blocked on its own D1. This phase is genuinely independent of that block (`00-overview.md` §3) — proceeding here does not require Phase 3's D1 to be answered first, and answering this phase's own decisions (`25-decision-record.md`) does not require touching anything Phase 3 owns.

## 2. Why this is the right-sized next step, not a jump to Phase 10

Per `00-vision.md` §4 and `19-first-industry-recommendation.md` (not re-read line-by-line this session, but its conclusion is unchanged by anything found here): this plan explicitly does not pick a new industry. It builds the schema a new industry will eventually need, without committing to which one or when. This mirrors Phase 2B's own discipline of building the _capability_ a future industry needs (`INVENTORY_BATCH`) without launching that industry — same pattern, applied to the schema layer instead of the enforcement layer.

## 3. Who benefits from this phase shipping, concretely, before Phase 10 is chosen

- **Phase 10 planning itself**: whichever industry is eventually chosen needs a `business_types` row to seed from (`16-phase-roadmap.md` Phase 10's own stated readiness gate: "Phase 1 complete... a new business type needs a `business_types` row to seed from"). Shipping this now means that gate is already closed by the time Phase 10 planning starts, rather than being discovered as a blocker mid-planning.
- **`tenant.schemas.ts`'s hardcoded 2-value enum** (`01-current-code-evidence.md` §2 row 5) stops being the boundary a new business type must fight through — this phase's `21-file-level-change-plan.md` addresses it directly.
- **No urgency, no deadline** — this is groundwork, not a response to a specific incident or customer ask. Sequencing it now vs. later is a planning-efficiency choice (do it while the architecture is fresh in context), not a business-critical one.

## 4. Non-goals

- Does not select Distribution/Manufacturing/Hotel/Healthcare as the next industry.
- Does not build `MODULE_REGISTRY` (confirmed superseded, `00-overview.md` §6).
- Does not build the provisioning-time consumer of `default_capability_keys` (D1's seed data is descriptive only in this phase).
- Does not touch `phase-03`'s scope, files, or migration.
- Does not start a deprecation clock on `tenants.vertical` — it remains permanently synced, not phased out, until a separate future decision revisits that.
