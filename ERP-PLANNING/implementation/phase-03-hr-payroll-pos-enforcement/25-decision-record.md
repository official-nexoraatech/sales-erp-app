# 25 — Decision Record

Per CLAUDE.md §1 and the precedent `phase-02-inventory-batch-capability/26-decision-record.md` set: decisions requiring business judgment are recorded explicitly, not silently resolved, even when a recommendation is offered.

**Status: D1, D1b, D2, and D3 are all CONFIRMED by the user, 2026-08-19.** This phase is cleared to proceed to implementation — see `24-pre-implementation-review.md`'s updated verdict. Decisions below are preserved in their original form (including the recommendation rationale) with each one's confirmed answer stated at its top, per this repo's convention of not rewriting decision history after the fact.

---

## D1 — Rollout safety given the flag-default-vs-real-usage mismatch

**CONFIRMED 2026-08-19: Option (a), plan-derived backfill.**

### The problem

`pos.enabled` and `hr.payroll.enabled` both default to `false` at provisioning and have never been read by any route-access-control code. There is no existing mechanism that would have kept a real tenant's flag value in sync with whether that tenant actually uses POS or Payroll. If Phase 3 ships `requireCapability` enforcement and a real, currently-active tenant's flag happens to be `false`, that tenant's next POS sale or payroll run returns `403 CAPABILITY_NOT_ENABLED` — a self-inflicted outage on a revenue/payroll-critical path, not a security fix.

This is structurally different from Phase 2B's `INVENTORY_BATCH`, where the gated behavior (`fefoEnabled: true`) had zero existing users by construction. Here, the _feature_ has existing (or plausibly existing, once real tenants exist) users; only the _enforcement_ is new.

### Options

**(a) Backfill first, enforce second.** Before deploying `requireCapability` enforcement, run a migration/ops step that sets `pos.enabled = true` and `hr.payroll.enabled = true` for every tenant with evidence of real usage (e.g., any `pos_sessions` row, any `payroll_runs` row, or — more conservatively — every existing tenant unconditionally, treating "already provisioned" as evidence of legitimate access, matching the precedent `39-implementation-report.md` §6 set for `INVENTORY_BATCH`'s _own_ global-default choice). Enforcement then goes live safely, because every tenant that could be affected already resolves `true`.

**(b) Shadow/dry-run mode first.** Deploy `requireCapability` in a non-enforcing "log only" mode for a fixed window (matching `15-rollout-and-rollback.md`'s — Phase 1's own doc — precedent of "what the next phase's rollout must look like"), recording every would-be-403 via the existing `erp_capability_check_denied_total` metric (labelled `outcome: 'disabled'`) without actually blocking the request. Only flip to real enforcement once the metric shows zero real-tenant denials over the observation window. Requires a small, temporary code branch (an env-var or per-route flag gating whether `requireCapability`'s `403` path actually replies or only logs+increments) that must itself be removed once enforcement is confirmed safe — a real, if small, deviation from Phase 1/2B's exact `requireCapability` shape, and must be called out plainly if chosen.

**(c) Enforce immediately, accept the risk.** Justifiable only if it is confirmed that no real production tenant exists yet (this environment: confirmed dev-only per `project_dev_phase_no_data` — but this decision record must not assume that stays true by the time this phase actually ships).

### Recommendation, revised after live-DB evidence: **(a), specifically as "re-derive each tenant's flags from its own plan's `plan_entitlements.feature_flags`" — not a blanket true, and not a usage-evidence-only backfill.**

Live data (`01-current-code-evidence.md` §5) shows this is not arbitrary drift to paper over — `pos.enabled`/`hr.payroll.enabled` are a real, intentional plan-tier design already encoded in `plan_entitlements` (`STARTER`: neither; `GROWTH`: `pos.enabled` only; `ENTERPRISE`: both), just never enforced. That reframes the correct backfill: not "make every tenant `true`" (which would silently upgrade every `STARTER`/`GROWTH` tenant beyond what they're entitled to — 25 of 28 dev tenants), and not "only tenants with usage-history evidence" (which misses tenant `1`, a real `ENTERPRISE` tenant with **zero** `feature_flags` rows for either key — entitled, but never actually granted, almost certainly because `assignPlanEntitlements` was never re-run for it since these keys were added to the `ENTERPRISE` template).

**The correct backfill is: for every existing tenant, set each flag to whatever that tenant's current `plan`'s `plan_entitlements.feature_flags` says it should be** — functionally equivalent to re-running `BillingService.assignPlanEntitlements(tenantId, tenant.plan)` for every tenant, scoped to just these two keys (re-running the full function is broader than needed and would also re-touch `maxUsers`/`maxBranches`/`next_billing_date`, out of scope here). This is simultaneously: safe (no tenant gets a capability outside its plan, so enforcement can never take away something a tenant was legitimately using outside its entitlement — in this dataset, zero `STARTER` tenants show any POS/payroll usage, consistent with the plan design having held even though it was never enforced), and correcting (tenant 1's real drift gets fixed as a side effect, not missed).

**Residual risk this doesn't cover**: a `STARTER`/`GROWTH` tenant that _is_ somehow using POS/Payroll today (not visible in this dev dataset, but not provable absent in a real production dataset either) would be **correctly** denied once enforcement ships — that is enforcement doing its job (closing a real entitlement gap), not a bug, but it is still a behavior change for that tenant and must be communicated as such, not silently shipped as if it were purely risk-free. This is why (b) — a shadow-mode observation window — remains worth layering on top of the plan-derived backfill in a real production rollout: it would surface exactly this class of tenant (using a feature outside its plan) before enforcement goes live, turning a silent breakage into a visible, plannable conversation with that customer.

**This is not decided by this document.** The user must confirm: (i) the plan-derived backfill approach itself, and (ii) whether to layer a shadow-mode observation window on top before real enforcement, before `06-database-impact.md`/`19-rollout-and-rollback.md` can be finalized into an actual migration file or rollout script.

### D1b — a consequence of D1 that must be decided alongside it, not separately

**CONFIRMED 2026-08-19: Option (ii), change the provisioning default to enabled.**

If D1 backfills **existing** tenants to `true`, `TenantProvisioner.seedFeatureFlags`'s provisioning-time default (`false` for both keys, unchanged by this phase — `06-database-impact.md`) means **every tenant provisioned after this phase ships** still starts with both capabilities disabled. Today that's harmless (nothing enforces the flag). After this phase, it means **every new tenant's first POS sale or payroll run fails with `403` out of the box**, until someone manually flips the flag — a regression relative to today's actual new-tenant experience (POS works immediately, unconditionally), even though no _existing_ tenant is affected.

Two sub-options, to be decided together with D1's main choice:

- **(i)** Leave the provisioning default at `false` — correct if POS/Payroll are meant to become genuinely opt-in/plan-gated features going forward (a real product decision, not this phase's to make unilaterally).
- **(ii)** Change `vertical-defaults.ts`'s `featureFlagOverrides` (or the base `seedFeatureFlags` list) so both default to `true` for `CLOTH_RETAIL`/`GROCERY`, preserving today's "it just works" new-tenant experience.

**Recommendation: (ii)**, to avoid silently introducing a new-tenant regression as a side effect of a security-boundary phase — but this is a product decision (do these become plan-gated features?) not an engineering one, and must be confirmed by the user alongside D1's main answer, not defaulted.

---

## D2 — Internal payroll routes (`/internal/payroll/prepare`, `/internal/payroll/send-slips`) — should they be capability-gated too?

**CONFIRMED 2026-08-19: Option (a), leave ungated (recommendation accepted, not overridden).**

`payroll.routes.ts:923` and `:1059` are called service-to-service (scheduler → hr-service, `requireInternalKey` only, no user JWT, no `tenantId` derived from `request.auth` the way every other gated route in this phase is). If `HR_PAYROLL` is disabled for a tenant, should the scheduler's payroll-prep/send-slips job still run for that tenant?

- **(a) Leave ungated.** The scheduler presumably only ever triggers these for tenants that have payroll data to process in the first place; gating would require the internal-route caller to also resolve `tenantId` → capability state, a shape `requireCapability` doesn't naturally fit (no `request.auth`). Simplest, matches "don't touch what isn't proven broken."
- **(b) Gate them.** Adds defense-in-depth (a disabled tenant's data can't be processed even by an internal job), but requires either a `tenantId`-taking variant of the capability check or wrapping `isCapabilityEnabled` manually inside the handler (an in-handler pattern, matching `item.routes.ts`'s precedent) rather than a preHandler.

**Recommendation: (a) for this phase**, explicitly deferred, not silently skipped. The two internal routes are not part of "the six user-facing payroll routes" this phase's acceptance criteria target; revisit only if a real incident (a disabled tenant's payroll job still firing) demonstrates (a) is insufficient. Requires user confirmation before `07-api-contracts.md`/`21-file-level-change-plan.md` treat this as settled.

---

## D3 — POS Z-report and promotion-application routes: gate now, or defer to a Phase 3C?

**CONFIRMED 2026-08-19: gate all three files together in Phase 3B (recommendation accepted, not overridden).**

`day-end.routes.ts` (Z-report) and one route in `promotion.routes.ts` are real parts of the POS checkout surface (§`01-current-code-evidence.md` §4) but live in separate files, registered separately, with separate route-level test files. Gating all three files in one Phase 3B keeps "the POS capability" coherent (a tenant with POS off shouldn't be able to generate a Z-report either — there'd be nothing to settle). Deferring `day-end.routes.ts`/`promotion.routes.ts` to a later sub-phase would ship a POS gate with a known, immediate gap (Z-report still reachable with POS off).

**Recommendation: gate all three files together in Phase 3B**, not split further — the risk/effort of adding two more preHandlers to already-open files is small relative to the cost of a second review/rollout cycle for what is conceptually one capability boundary. This is the plan's default; flagged here (not silently assumed) because a reviewer might reasonably prefer the smaller, single-file diff instead. Non-blocking — proceed with the recommendation unless the user objects.

---

## Capability boundary — confirmed, no new capability needed

`HR_PAYROLL` and `POS` already exist, already have correct `flagKey`/`permissions` metadata (`01-current-code-evidence.md` §1), and already passed Phase 1's registry-completeness/cycle-detection tests. This phase adds zero registry entries — a pure enforcement-and-navigation phase, unlike Phase 2B which was enforcement + a new capability + new domain behavior (`fefoEnabled`) bundled together. Recorded here for the pre-implementation review's own checklist (`24-pre-implementation-review.md`), which must not assume a capability-definition step is needed when it isn't.
