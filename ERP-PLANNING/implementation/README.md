# ERP-PLANNING/implementation — How to Use This Folder

This folder converts the approved architecture in `ERP-PLANNING/multi-industry-platform/` (docs 00–21) into implementation-ready execution plans. It is the **third layer** of this repo's planning hierarchy:

```
ERP-PLANNING/multi-industry-platform/   ← WHY and WHAT (architecture, approved)
ERP-PLANNING/implementation/            ← HOW and WHERE (this folder — file-level plans)
apps/, packages/                        ← actual code (nothing here changes until a
                                            coding session executes one of these plans)
```

**Nothing under `ERP-PLANNING/implementation/` is code.** No source file, migration, or config was changed to produce these documents. Every plan here is written to be handed to a separate AI coding session with the instruction "implement exactly this phase, without rediscovering the architecture."

## Contents

- `00-roadmap-analysis.md` — how the source 12-phase roadmap (`multi-industry-platform/16-phase-roadmap.md`) was re-analyzed against fresh codebase evidence, including one significant correction (Business Profile DB and Capability Registry are independent tracks, not sequential) and a re-scope of Phase 7 (Commerce Core generalization — mostly already shipped, verified this session).
- `phase-01-capability-foundation/` — complete, file-level implementation plan for **Phase 1: Capability Foundation** (the `CAPABILITY_REGISTRY`/`requireCapability()` mechanism, doc 21's model made concrete). This is the only phase planned to file-level detail so far.

## Phase 1 status: READY FOR IMPLEMENTATION

Passed an independent pre-implementation gate review (`phase-01-capability-foundation/18-pre-implementation-review.md`) on 2026-08-18, then all four decisions that review surfaced were resolved by the architect (frontend capability delivery, error-contract status codes, deferred hardening risks, fail-closed-on-error). See that file's §17 for the full decision record. Docs 00, 04, 05, 08, 11, 12, 14, 16, 17 were updated to apply the decisions; a new `19-deferred-hardening-risks.md` tracks two pre-existing, out-of-scope risks found during the review.

## Phase 1 at a glance

**What it builds:** the capability-resolution _mechanism_ — a code-defined registry, a `platform-sdk` guard function mirroring the existing `requirePermission()`, the `CAPABILITY_NOT_ENABLED` error contract, and a frontend capability-delivery path — proven against 2 real, already-existing feature flags (`hr.payroll.enabled`, `pos.enabled`).

**What it does NOT build:** no database migration, no wiring onto real HR/Production routes, no real nav group gating, no Business Profile (`industries`/`business_types`) tables, no billing/payment-gateway work. Those are later phases (see `00-roadmap-analysis.md`'s renumbering table).

**Why this scope:** verified this session that capability resolution has zero runtime dependency on the Business Profile DB tables — it only needs `feature_flags`, which already exists and already has real data for every current tenant. Building the mechanism first, provably correct and inert, before wiring it onto anything live, is the safest sequencing given CLAUDE.md's incremental-verification principle and the existing repo convention (`ERP-PLANNING/README.md`'s "one phase, one session, verified before moving on").

## Reading order for a coding session picking up Phase 1

1. `ERP-PLANNING/multi-industry-platform/21-capability-resolution-architecture.md` — the approved conceptual model.
2. `ERP-PLANNING/implementation/00-roadmap-analysis.md` — why Phase 1 is scoped the way it is.
3. `phase-01-capability-foundation/00-overview.md` onward, in file order.

## Future phases (not detailed to file-level yet)

See `00-roadmap-analysis.md`'s renumbering table for the summary sequence. Full file-level plans for later phases will be generated after Phase 1 is implemented and validated — generating them now would risk drifting from whatever Phase 1 actually ships (interfaces, exact flag keys used, test patterns proven out), per the explicit instruction not to over-plan ahead of validated groundwork.
