# ERP-PLANNING/implementation/phase-03-hr-payroll-pos-enforcement — How to Use This Folder

Status: **Planning only.** No source file, migration, or config was changed to produce any document in this folder — verified: zero `Edit`/`Write` calls against `apps/`, `packages/`, or `packages/db-client/migrations/` in the session that wrote this plan. Written 2026-08-19, following `phase-02-inventory-batch-capability/41-phase-2b-closure-review.md` §14's finding that this exact gap (HR_PAYROLL/POS route wiring, the roadmap's original "Phase 4/5" step) was still open, and the user's explicit choice to pursue it next.

## Start here

**Read `00-overview.md` first**, then `01-current-code-evidence.md` and `26-affected-flow-matrix.md` for the evidence base, then `25-decision-record.md` before anything else — **D1 is blocking.**

## Current status: CLEARED TO CODE (2026-08-19)

All four decisions are confirmed by the user (`25-decision-record.md`): **D1** — plan-derived backfill (set each tenant's flags to match its own plan's entitlement, not a blanket true/false); **D1b** — change the provisioning default to enabled for `CLOTH_RETAIL`/`GROCERY`, preserving today's out-of-the-box behavior for new tenants; **D2** — leave the two internal payroll routes ungated; **D3** — gate all three POS-surface files (`pos.routes.ts`, `day-end.routes.ts`, `promotion.routes.ts`) together in one Phase 3B. See `24-pre-implementation-review.md`'s updated verdict for the remaining (non-blocking) implementation-time verification items.

## Why this, not Business Profile Foundation or the CRM/O2C split

`41-phase-2b-closure-review.md` §14.3 offered three legitimate next steps and declined to pick one; the user picked this one. See `02-business-requirements.md` §1 for the full evidence case (lower design risk than either alternative, reuses an already-twice-proven mechanism, directly closes a roadmap-tracking gap the last phase's own review found).

## What "done" looks like

Phase 3A: all six user-facing `payroll.routes.ts` routes correctly deny access when a tenant's `HR_PAYROLL` capability is off, exactly as designed, with zero behavior change for any tenant whose flag already (or now, via the resolved D1 backfill) matches its plan's entitlement; the `HR & PAYROLL` nav group's payroll-specific node reflects the same state. Phase 3B: the same for all fifteen `POS`-surface routes across `pos.routes.ts`/`day-end.routes.ts`/`promotion.routes.ts`, plus graceful `pos-frontend` error handling for the new `403`. Full criteria: `20-acceptance-criteria.md`.

## Explicit non-goals

Not a new capability. Not `INVENTORY_BATCH`-related. Not Business Profile Foundation. Not the CRM/O2C split. Not a change to what Payroll or POS _do_ — authorization-boundary work only. Not a guarantee of zero behavior change for every conceivable tenant state — only for correctly-entitled ones (`17-migration-and-backward-compatibility.md`'s explicit, honest scope statement).

## One documentation finding surfaced along the way, not fixed here

`multi-industry-platform/03-target-architecture.md` §6's request-time diagram has the capability/permission check ordering backwards relative to every other document (`05`, `07`, `21`) and the actual shipped Phase 1/2B code. Recorded as a `CONTRADICTION` in `24-pre-implementation-review.md`, resolved in favor of the real implementation (capability-then-permission) — the stale diagram itself is left for a future documentation-maintenance pass, per this repo's practice of not editing the architecture layer from an implementation-planning session.
