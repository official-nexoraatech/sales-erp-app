# 00 — Phase 3 (HR_PAYROLL / POS Capability Enforcement): Overview

Status: Planning only. No code, migration, or config changed to produce this document set. Written 2026-08-19, following Phase 2B's closure review (`phase-02-inventory-batch-capability/41-phase-2b-closure-review.md`), which independently found this exact gap and flagged it for the user's attention before any further roadmap work.

---

## 1. What this phase is, in one sentence

Wire the already-built, already-tested Phase 1 capability-resolution mechanism (`CAPABILITY_REGISTRY`, `requireCapability()`, `isCapabilityEnabled()`) onto real backend routes for the **two capabilities the original source roadmap actually named for this step** — `HR_PAYROLL` and `POS` — and tag the corresponding frontend navigation, closing the gap `41-phase-2b-closure-review.md` §14 identified: both capabilities have existed in `CAPABILITY_REGISTRY` since Phase 1 (2026-08-18), are fully tested at the mechanism level, and are wired to **zero** production routes and **zero** nav entries.

## 2. Why this phase, and why now — evidence chain

1. **Source roadmap** (`multi-industry-platform/16-phase-roadmap.md`, Phase 4): "wire `requireModule` onto HR and Production route trees." Phase 5: capability-aware nav for that same wiring.
2. **`00-roadmap-analysis.md`**'s own renumbering table calls this "Phase 2 (future)": _"Wire `requireCapability` onto real HR/Production routes + tag real nav groups — only after Phase 1 is validated."_ Phase 1 has been validated (`21-post-implementation-review.md`: VERIFIED WITH FOLLOW-UP, follow-up since closed — see `phase-02-inventory-batch-capability/38-phase-2a-final-verification.md`).
3. **What actually got built next was `phase-02-inventory-batch-capability`** (`INVENTORY_BATCH`), a different, also-valuable capability that the roadmap never named for this slot — confirmed by direct code inspection: `requireCapability(` has exactly one call site anywhere in `apps/` (`stock.routes.ts:292`), and `HR_PAYROLL`/`POS` appear nowhere in `apps/web-frontend/src/lib/navigation.ts` and are wired to zero backend routes (re-confirmed this session, §on `01-current-code-evidence.md`).
4. **`41-phase-2b-closure-review.md` §14.3** lists three legitimate next steps and explicitly declines to pick one: Business Profile Foundation, "the literal Phase 4/5 proof" (this phase), or advancing the CRM/O2C split. The user selected this option.

## 3. What this phase builds

- Backend enforcement: `requireCapability('HR_PAYROLL', ...)` on `apps/hr-service`'s payroll route tree; `requireCapability('POS', ...)` on `apps/sales-service`'s POS route surface (see `01-current-code-evidence.md` §4 for why this surface is three files, not one).
- Frontend: tag the existing `HR & PAYROLL` nav group in `apps/web-frontend/src/lib/navigation.ts` with `capabilityKey: 'HR_PAYROLL'` (the field has existed, unused, since Phase 1). `POS` has **no equivalent web-frontend nav group to tag** — POS lives in the separate `pos-frontend` app, which has no capability-awareness at all (confirmed absent, `01-current-code-evidence.md` §7); tagging its nav is therefore a distinct, larger piece of work than Phase 1's original "extend `filterNavGroups`" assumption.
- Zero new capability registry entries — `HR_PAYROLL` and `POS` already exist, unchanged in shape, since Phase 1.
- Zero schema/migration change **unless** the blocking rollout-safety decision in `26-decision-record.md` (D1) resolves toward a data backfill — see that document before assuming this phase is migration-free.

## 4. The finding that makes this phase harder than Phase 2B, and must be read before anything else

Phase 2B's `INVENTORY_BATCH` capability gated a **brand-new** write path (`fefoEnabled`) that no existing tenant could have used before that phase shipped — so gating it could not break anyone by construction (`36-implementation-report.md` / `39-implementation-report.md`'s own repeated point).

**`HR_PAYROLL` and `POS` are the opposite case: both gate long-existing, actively-used, revenue-relevant flows that have never been gated by anything before.** Direct query against the dev database (`01-current-code-evidence.md` §5) found:

- `pos.enabled` and `hr.payroll.enabled` both default to `false` at provisioning (`TenantProvisioner.seedFeatureFlags`, `vertical-defaults.ts` — neither `CLOTH_RETAIL` nor `GROCERY`'s `featureFlagOverrides` touches either key).
- Of 28 tenants in the dev database, only 2 have either flag set to `true`.
- Because **no code today reads either flag to gate access**, a tenant's flag value has never had to be correct for that tenant to use POS or Payroll — it has been decorative. There is no existing evidence loop that would have caught a tenant using POS with `pos.enabled = false`.
- The dev database's own usage rows (`pos_sessions`, `payroll_runs`) happen to belong only to the one tenant whose flags are already `true` — reassuring for this dataset, but this is confirmed dev/test data (`project_dev_phase_no_data` — no real production tenants exist yet in this environment), so it cannot settle whether a real production tenant's flag value reflects its real usage.

**Conclusion: enabling enforcement on `POS`/`HR_PAYROLL` without first verifying (or forcing) that every currently-active tenant's flag is `true` risks an outage-class regression — a paying tenant's checkout or payroll flow returning `403 CAPABILITY_NOT_ENABLED` the moment this phase deploys.** This is Decision D1 in `26-decision-record.md`, and it is a **blocking decision** in the same sense Phase 2A's D1 was: this phase's file-level plan cannot be finalized until it is resolved, because the resolution determines whether a migration/backfill step exists in `06-database-impact.md` at all.

## 5. Sub-phase split

Given the asymmetry in blast radius between the two capabilities (§7 below), this phase is split:

- **Phase 3A — `HR_PAYROLL` enforcement.** Single service (`hr-service`), single route file (`payroll.routes.ts`), backoffice-only (not revenue/checkout-path), lower blast radius. Ships first, proves the pattern.
- **Phase 3B — `POS` enforcement.** Three files across `sales-service`, plus the `pos-frontend` capability-awareness gap, revenue/checkout-critical, higher blast radius, explicitly gated on D1's resolution. Does not start until 3A is closed and D1 is answered.

This mirrors the Phase 2A/2B precedent (lower-risk prerequisite, then the higher-stakes piece) and the pre-implementation review's own §17-item mandate not to bundle unlike-risk changes into one rollout.

## 6. What this phase does NOT do

- Does not touch `INVENTORY_BATCH` or any Phase 2B file.
- Does not touch the Business Profile (`industries`/`business_types`) workstream — independent, not started, not a prerequisite for this phase (per `00-roadmap-analysis.md` §B/§C, capability resolution has zero dependency on those tables).
- Does not touch the CRM/O2C split.
- Does not add a third capability to the registry.
- Does not change the fail-closed / three-outcome (`CAPABILITY_NOT_ENABLED` / `FORBIDDEN` / `CAPABILITY_RESOLUTION_UNAVAILABLE`) contract Phase 1 established — reused exactly as-is.
- Does not gate `employee.routes.ts`'s in-handler `PAYROLL_VIEW` salary-field visibility check — that's a permission concern, not a module-presence concern, and is unaffected by whether `HR_PAYROLL` is enabled (see `01-current-code-evidence.md` §3 for why this is excluded, not merely forgotten).
- Does not build `pos-frontend`'s capability infrastructure from scratch as a side effect — Phase 3B scopes exactly what's needed (§9 of `09-navigation-and-frontend.md`), not a general pos-frontend capability system.

## 7. Document map

| File                                         | Contents                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `01-current-code-evidence.md`                | What exists today, verified by direct code + live-DB reading                  |
| `02-business-requirements.md`                | Why HR_PAYROLL/POS, why now, why split into 3A/3B                             |
| `03-capability-definition.md`                | Confirms the existing registry entries are unchanged; what "enforcement" adds |
| `04-domain-model.md`                         | Confirms no new entities (schema already shipped in Phase 1/pre-existing)     |
| `05-service-impact.md`                       | Exact files/functions changed in `hr-service` and `sales-service`             |
| `06-database-impact.md`                      | The D1-dependent migration decision                                           |
| `07-api-contracts.md`                        | Route-by-route contract changes for both sub-phases                           |
| `08-permissions-and-rbac.md`                 | Confirms zero new permissions; capability+permission composition ordering     |
| `09-navigation-and-frontend.md`              | HR & PAYROLL nav tagging; the pos-frontend gap                                |
| `10-entitlement-impact.md`                   | How this interacts with `BillingService`/`plan_entitlements`                  |
| `11-event-impact.md`                         | Confirms no new event types needed                                            |
| `12-reporting-impact.md`                     | Confirms no report changes needed                                             |
| `13-search-impact.md`                        | Confirms out of scope                                                         |
| `14-ai-copilot-impact.md`                    | Whether any copilot tool touches payroll/POS routes today                     |
| `15-security-impact.md`                      | Bypass-vector analysis, mirroring Phase 1/2B's own checklist                  |
| `16-testing-strategy.md`                     | Unit/integration/route-level test plan for both sub-phases                    |
| `17-migration-and-backward-compatibility.md` | Existing-tenant compatibility, keyed to D1's resolution                       |
| `18-observability.md`                        | Reuse of Phase 1's `erp_capability_check_denied_total` metric                 |
| `19-rollout-and-rollback.md`                 | Shadow-mode-first rollout sequencing (the D1-driven safety mechanism)         |
| `20-acceptance-criteria.md`                  | Testable criteria, split by sub-phase                                         |
| `21-file-level-change-plan.md`               | Concrete file list, CREATE/MODIFY/TEST classification                         |
| `22-risk-register.md`                        | Led by the D1 outage risk                                                     |
| `23-executive-summary.md`                    | One-page summary for a reviewer                                               |
| `24-pre-implementation-review.md`            | Gate — must answer D1 before Phase 3A/3B coding starts                        |
| `25-decision-record.md`                      | D1 (blocking) + D2/D3 (non-blocking)                                          |
| `26-affected-flow-matrix.md`                 | Every route/flow touched by POS's three-file surface                          |

## 8. Reading order for a coding session picking up this phase

1. `ERP-PLANNING/multi-industry-platform/21-capability-resolution-architecture.md` — the approved mechanism (unchanged).
2. This file, then `01-current-code-evidence.md` and `26-affected-flow-matrix.md`.
3. `25-decision-record.md` — **do not write code until D1 is resolved by the user.**
4. `24-pre-implementation-review.md` for the final gate.
