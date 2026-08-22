# 02 — Business Requirements

## 1. Why HR_PAYROLL and POS, not another candidate

`41-phase-2b-closure-review.md` §14.3 offered three legitimate next steps: Business Profile Foundation, this phase, or advancing the CRM/O2C split. The user chose this phase. The evidence supporting it as a reasonable choice (independent of the user's preference, which is sufficient on its own):

- Both capabilities already exist in `CAPABILITY_REGISTRY`, already tested at the mechanism level, already have real, non-placeholder permission constants (`01-current-code-evidence.md` §1) — zero new capability-design work.
- The enforcement mechanism (`requireCapability`, `isCapabilityEnabled`) is proven twice now (Phase 1's own tests, Phase 2B's real-route proof) — this phase is pure application of an established pattern, not new architecture.
- It directly closes the gap the roadmap's own tracking review found (`41`§14.1): the roadmap named these two capabilities for "the proof step," and a different capability got proven instead.
- Lower design risk than Business Profile Foundation (new tables, new provisioning-time model) or the CRM/O2C split (flagged as needing "several dedicated sessions with git-stash isolation," high financial/CRM stakes).

## 2. Why split into 3A (HR_PAYROLL) and 3B (POS)

Not a business requirement in the sense of a stakeholder ask — a risk-sequencing decision, justified by evidence:

|                               | HR_PAYROLL                                                                                                                                   | POS                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Route surface                 | 1 file, 6 user-facing routes                                                                                                                 | 3 files, 15 routes                                                                |
| Audience                      | HR-role staff only                                                                                                                           | every cashier/till, every day                                                     |
| Failure mode if wrongly gated | A payroll run can't be created — backoffice delay, recoverable same day                                                                      | A checkout can't complete — customer-facing, immediate revenue impact             |
| Frontend surface              | Existing web-frontend nav group already exists, already has the plumbing (Phase 1 built `filterNavGroups`'s `enabledCapabilities` parameter) | No existing nav-aware frontend at all (`pos-frontend` has zero capability wiring) |

Shipping the lower-blast-radius capability first validates the exact same `requireCapability`-on-a-route-tree pattern with a much smaller failure surface, consistent with the precedent Phase 2A (lower-risk prerequisite) → Phase 2B (main capability) already established in this repository.

## 3. Non-goals

- Does not change what HR Payroll or POS _do_ — zero business-logic change to `PayrollEngine`, `InvoiceService`, or any other domain service. This is authorization-boundary work only.
- Does not introduce plan-tiering (e.g., "POS only on GROWTH+ plan") — `plan_entitlements` is not touched (`10-entitlement-impact.md`).
- Does not change either capability's `applicableBusinessTypes` metadata — both already list `CLOTH_RETAIL`/`GROCERY`, both verticals already use both features today (per real dev-DB evidence, tenant 2).
- Does not attempt to determine, from this planning pass alone, which real tenants (in a future production environment) are "safe" to enforce against — that determination is D1's rollout mechanism, executed at implementation/deploy time with real data, not guessed here.
