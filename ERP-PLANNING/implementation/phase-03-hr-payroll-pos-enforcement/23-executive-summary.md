# 23 — Executive Summary

## What

Wire the existing, already-tested Phase 1 capability mechanism (`requireCapability`, `isCapabilityEnabled`) onto real routes for `HR_PAYROLL` (6 routes, `apps/hr-service`) and `POS` (15 routes across 3 files, `apps/sales-service`), and tag the corresponding `web-frontend` navigation. Split into Phase 3A (HR_PAYROLL, lower risk) and Phase 3B (POS, higher risk), shipped sequentially.

## Why

Closes a gap Phase 2B's own closure review found: the source roadmap named these two capabilities as the ones to prove the enforcement mechanism on; a different capability (`INVENTORY_BATCH`) got proven instead. Both `HR_PAYROLL`/`POS` have sat fully built, registered, and untested-at-the-route-level since Phase 1 (2026-08-18).

## The finding that shapes this whole plan

Unlike Phase 2B's `INVENTORY_BATCH` (a brand-new write path nobody could have used yet), `HR_PAYROLL`/`POS` gate **long-existing, actively-used** flows. Live query against the dev database found both flags default `false` at provisioning, are read by zero existing code, and — critically — turn out to encode a real, never-enforced **plan-tier design**: `plan_entitlements` shows `STARTER` gets neither, `GROWTH` gets `POS` only, `ENTERPRISE` gets both. One real tenant (`id 1`, `ENTERPRISE` plan) has **zero** flag rows for either key despite being plan-entitled — a concrete, already-existing data-integrity gap this phase's evidence surfaced, not invented.

**This means enforcement cannot simply be switched on.** It requires a data correction first (setting each tenant's flags to match its own plan's entitlement — not a blanket "everyone gets it," which would over-grant 25 of 28 dev tenants beyond their plan). This is Decision D1, recorded in `25-decision-record.md`, and it is **blocking**: no code should be written until the user confirms the backfill approach (and D1b, its provisioning-default follow-on).

## Scope

- Backend: one `preHandler` addition per route, 18 routes total, zero new SDK/mechanism code.
- Frontend: one nav-node tag (`web-frontend`); graceful-error-handling only for `pos-frontend` (no capability-aware UI built there — confirmed out of proportionate scope).
- Database: zero schema change; one conditional data-only migration, shape dependent on D1.
- Zero new capability, zero new permission, zero new domain logic, zero financial-calculation change.

## Risk profile

Led by one risk: a real tenant using POS/Payroll today with its flag incorrectly `false` gets a hard `403` the moment enforcement ships. Mitigated by a plan-derived backfill (not a blanket one) plus an optional shadow-mode observation window. Every other risk in `22-risk-register.md` is lower-severity and independently mitigated.

## What this phase is not

Not a Business Profile Foundation phase, not a CRM/O2C split step, not a new capability, not a Phase 10 (first industry) enabler by itself — per `41-phase-2b-closure-review.md` §14.2, Phase 10 still needs Business Profile Foundation and the CRM/O2C split regardless of this phase's outcome.

## Gate before coding starts

`24-pre-implementation-review.md` — D1/D1b/D2/D3 must all be answered by the user first.
