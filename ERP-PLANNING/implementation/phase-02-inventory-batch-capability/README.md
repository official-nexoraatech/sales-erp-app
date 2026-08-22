# ERP-PLANNING/implementation/phase-02-inventory-batch-capability — How to Use This Folder

Status: **Planning only, REVISED after a NOT-READY gate review.** No source file, migration, or config has been changed to produce any document in this folder, in either the original planning pass or this revision (verified both times: zero `Edit`/`Write` calls against `apps/`, `packages/`, or `packages/db-client/migrations/`). Original plan written 2026-08-18, immediately following Phase 1's "VERIFIED WITH FOLLOW-UP" verdict. Independently gate-reviewed the same day (`24-pre-implementation-review.md`, verdict: **NOT READY**). Revised the same day in response (`25`–`33`).

## Start here: read the revised plan first, not the original

**Read `33-revised-executive-summary.md` first.** It is the current decision record. Then, if you need the full analysis behind it: `25-revised-scope.md` (what changed and why), `26-decision-record.md` (the open decisions — D1 is blocking), `27-affected-flow-matrix.md` (all nine affected flows), `28-financial-impact-analysis.md`, `29-expiry-policy-analysis.md` (D2, explicitly open), `30-revised-file-level-change-plan.md`, `31-revised-acceptance-criteria.md`, `32-revised-risk-register.md`.

**The original plan (`00`–`23`) and the gate review (`24-pre-implementation-review.md`) are preserved, unmodified, as the record of what was wrong and why.** Do not implement from `00`–`23` directly — their central technical premise (FEFO ordering doesn't exist yet) was factually wrong, corrected by `24` and superseded by `25`–`33`. The parts of `00`–`23` that were _not_ wrong (registry/RBAC/migration/frontend-nav/entitlement mechanics: `03`, `06`, `08`–`14`, `18`, `19`) remain valid and are cross-referenced, not restated, by the revised documents.

## Current status: still not ready for implementation

`26-decision-record.md` D1 (how to reconcile `sales-service`'s stale duplicate valuation engine with the shared one) is a **blocking** decision the user has not yet confirmed. A recommendation is on record (migrate to the shared `@erp/sdk` engine). D2 (expired-stock policy) is explicitly left open as a business decision. Do not begin Phase 2A implementation until D1 is confirmed — see `33-revised-executive-summary.md` §10.

## Why this, not a new industry

Unchanged from the original framing: this plan picks the **capability** Distribution/Manufacturing need first, without launching either industry. See `00-overview.md` §2–3 (still accurate) and `25-revised-scope.md` §7 for the restated non-goals.

## What "done" looks like (revised)

A Grocery (or future Distribution/Manufacturing) tenant's inventory manager can mark an item as batch-tracked through the existing item-edit screen; stock issuance for that item then prefers earliest-expiring batches **consistently across all nine consumption/capture flows** (invoices, POS, sales returns, transfers, adjustments, physical verification, purchase returns, job-work material issue — not just inventory-service as the original plan assumed); a capability-gated "Near-Expiry Stock" page shows what needs attention; every existing tenant's behavior is provably unchanged unless an admin explicitly opts an item in; and the UI is explicit that this reorders consumption preference without blocking expired stock. Full criteria: `31-revised-acceptance-criteria.md`.

## Explicit non-goals (unchanged, restated)

Not Distribution. Not Manufacturing. Not Hotel. Not Hospital. Not the Business Profile foundation. Not the CRM/O2C split. Not `HR_PAYROLL`/`POS` route-wiring. Not `MULTI_UOM`. **New in this revision**: not expired-stock blocking/warning (Phase 2C, blocked on D2) — see `25-revised-scope.md` §7.
