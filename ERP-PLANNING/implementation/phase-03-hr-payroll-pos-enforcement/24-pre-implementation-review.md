# 24 — Pre-Implementation Review

Gate document — mirrors `phase-01-capability-foundation/18-pre-implementation-review.md`'s and `phase-02-inventory-batch-capability/24-pre-implementation-review.md`'s role: answer the standard checklist before any coding session starts on this phase. This review was performed against the planning documents above, not against code (none was written).

| Question                                                 | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is Phase 3 scope correct?                                | Scope (HR_PAYROLL + POS route/nav enforcement, split 3A/3B) is evidence-based, confirmed against live code and the roadmap's own tracking documents (`00-overview.md` §2). Yes.                                                                                                                                                                                                                                                                       |
| Are Phase 1 and Phase 2 prerequisites actually complete? | Phase 1: yes, `VERIFIED WITH FOLLOW-UP`, follow-up closed (`38-phase-2a-final-verification.md`). Phase 2B: yes, `CLOSED WITH FOLLOW-UPS`, follow-ups non-blocking and unrelated to this phase. Neither is a hard dependency for this phase's mechanism (already proven) — both confirmed complete anyway.                                                                                                                                             |
| Are all affected flows identified?                       | Yes for the backend route surface (`26-affected-flow-matrix.md`, 23 rows across both sub-phases) and cross-module dependency check (`InvoiceService` shared-path verification). One item remains genuinely open: AI Copilot tool-registration check (`14-ai-copilot-impact.md`) is `TO VERIFY`, not yet confirmed clear — must close before Phase 3B is called done, not before it starts (low risk either way per the mechanism's fail-safe design). |
| Are database changes safe?                               | **Conditional on D1.** The plan-derived backfill design (`06-database-impact.md`) is safe _as designed_, but its exact SQL depends on verifying `plan_entitlements`/`feature_flags`' real column constraints at implementation time — flagged, not yet executed. Not safe to consider "answered" until D1 itself is answered.                                                                                                                         |
| Are financial effects understood?                        | Yes — `26-affected-flow-matrix.md`'s financial trace confirms zero calculation-logic change; the only financial-adjacent risk is availability (a blocked payroll run), not correctness, unlike Phase 2B's FEFO/COGS finding.                                                                                                                                                                                                                          |
| Are APIs backward compatible?                            | **Conditionally yes** — for every tenant whose flag is (or becomes, via D1's backfill) correct, byte-identical. Explicitly **not** universally backward compatible in the "every possible tenant state" sense — `17-migration-and-backward-compatibility.md` states this honestly rather than rounding up.                                                                                                                                            |
| Are RBAC/entitlements correct?                           | Yes for RBAC (zero new permissions, existing composition pattern reused, `08-permissions-and-rbac.md`). Entitlements: the whole point of this phase is _closing_ a gap where they were defined but unenforced — correct once D1 ships, incorrect (in the sense of "not yet enforced") until then, which is the honest current state, not a defect in this plan.                                                                                       |
| Is capability resolution correct?                        | Yes — zero changes to `capability-guard.ts`/`capability-registry.ts`, reusing Phase 1's already-twice-proven mechanism unchanged.                                                                                                                                                                                                                                                                                                                     |
| Is migration safe?                                       | Conditional on D1, same as "are database changes safe" above.                                                                                                                                                                                                                                                                                                                                                                                         |
| Is rollback possible?                                    | Yes for code (trivial, `17`/`19`). Data rollback is possible but not required merely to roll back code — the "backfilled `true`, unenforced" state is a safe resting position, same logic Phase 1 itself lived in for months.                                                                                                                                                                                                                         |
| Are acceptance criteria measurable?                      | Yes — `20-acceptance-criteria.md` is checkbox-structured, each item tied to a specific test, query, or file-diff check, not a vague "works correctly" statement.                                                                                                                                                                                                                                                                                      |
| Are unresolved assumptions explicitly documented?        | Yes: D1/D1b (blocking), D2/D3 (non-blocking, recorded not defaulted), the AI Copilot `TO VERIFY`, the `plan_entitlements` seed-data `TO VERIFY`, the exact nav-node-to-tag `TO VERIFY`, the exact internal-migration-file-number `TO VERIFY`, the possible broader entitlement-drift class beyond these two flags (flagged as out-of-scope, not silently ignored).                                                                                    |

## Contradiction check against the architecture layer (per the governing task's own required quality gate)

Cross-checked this phase's design against `00-vision.md`, `03-target-architecture.md` (not read in full this session — `TO VERIFY` before implementation, though `21-capability-resolution-architecture.md` and `07-rbac-model.md`, which supersede/detail the relevant slices, were read in full), `05-module-capability-model.md`, `06-entitlement-model.md`, `07-rbac-model.md`, `08-navigation-model.md`, `13-security-architecture.md`, `18-decisions.md` (ADR-03 through ADR-07 all directly relevant, all read in full).

`03-target-architecture.md` has now been read in full (was pending at an earlier draft of this document; closed out below rather than left as a deferred check).

**One real contradiction found, not silently resolved:**

```
CONTRADICTION
  03-target-architecture.md §6's request-time diagram orders the checks as:
      requirePermission(X)  →  requireModule(moduleKey)
  i.e. PERMISSION FIRST, MODULE/CAPABILITY SECOND.

  This directly conflicts with:
    - 05-module-capability-model.md §5: "requireModule before requirePermission
      (cheaper failure, and 'module not enabled' is a clearer error than
      'permission denied' for a genuinely absent feature)"
    - 07-rbac-model.md §4: same ordering, capability first
    - The actual, shipped, twice-independently-reviewed Phase 1/2B implementation:
      capability-guard-route.test.ts's proven outcome matrix, and INVENTORY_BATCH's
      real route (stock.routes.ts:292) — both capability-then-permission
    - This Phase 3 plan's own 05-service-impact.md / 07-api-contracts.md /
      08-permissions-and-rbac.md, all specifying capability-then-permission

CURRENT STATE
  03-target-architecture.md's diagram (§6) is stale relative to every other
  document and the real, running code. It was written before 05/07's ordering
  rationale was fully worked out, and was never updated when they superseded it —
  the same kind of drift 21-capability-resolution-architecture.md's own preamble
  already flags in general ("supersedes the Module/Capability terminology split
  in 04/05/07/08... the storage/enforcement mechanism those docs describe is
  unchanged" — but that preamble doesn't specifically call out §6's ordering).

RECOMMENDED RESOLUTION
  Per Rule 4 (latest decision > final implementation report > post-implementation
  review > revised plan > original plan): the shipped, tested, independently
  reviewed implementation wins. This phase proceeds with capability-then-permission
  ordering, unchanged from this document set's existing specification — no plan
  document in this phase needs to change. 03-target-architecture.md §6's diagram
  should be corrected in a future documentation-maintenance pass (swap the two
  boxes) to stop misleading a future reader who starts there instead of at 05/07/21
  — flagged here per Rule 4/CLAUDE.md's "if you notice unrelated dead/stale content,
  mention it, don't silently fix it," since editing multi-industry-platform/ docs is
  outside this implementation-planning phase's own scope. Not blocking for this
  phase; recorded so it isn't rediscovered as a fresh confusion by a future session.
```

No other contradiction found. This phase is otherwise a direct, literal application of ADR-03 (feature-flags as the module-enablement mechanism), ADR-04 (RBAC composition, unchanged), ADR-05 (frontend nav tagging, no backend nav service), ADR-06 (no new trusted headers — `tenantId` stays JWT-derived throughout), and ADR-07 (no RLS dependency — this phase's isolation guarantee rests entirely on the existing, unmodified `tenantId`-scoped `PlatformFeatureFlags` mechanism, consistent with every other capability check in this codebase). `03-target-architecture.md` §§1-5, 7 (Business Profile model, module/capability model, entitlement distinctions, navigation, "what does not change") are all consistent with this phase's design — only §6's diagram ordering is stale.

## Verdict

**CLEARED TO CODE, as of 2026-08-19.** D1 (plan-derived backfill), D1b (change provisioning default to enabled), D2 (leave internal payroll routes ungated), and D3 (gate all three POS files together) are all confirmed by the user (`25-decision-record.md`). Every "conditionally yes, pending D1" answer above now resolves to a plain "yes."

**Remaining items are implementation-time verification, not decisions** — do not treat these as blocking, but do not skip them either:

- `10-entitlement-impact.md`'s `TO VERIFY`: confirm `plan_entitlements` seed data for all three plans before the backfill migration ships, since a mismatch there would silently undo the backfill on a later plan change.
- `14-ai-copilot-impact.md`'s open check: grep `ai-copilot-service`'s tool registrations against the 18 gated routes before calling Phase 3B done.
- Exact nav-node to tag (`09-navigation-and-frontend.md`), exact migration file number (`06-database-impact.md`, re-check the journal fresh), exact home for any new helper files.
- `16-testing-strategy.md`'s flagged fixture gap: `pos-completion.test.ts`, `pos-sessions-active.integration.test.ts`, `offline02-pos-sale-idempotency.test.ts` need `pos.enabled: true` added to their test tenant setup.

**Recommended implementation order**: Phase 3A (`HR_PAYROLL`) first, fully shipped and observed, before Phase 3B (`POS`) starts — per `00-overview.md` §5's risk-sequencing rationale, unchanged by these decisions.
