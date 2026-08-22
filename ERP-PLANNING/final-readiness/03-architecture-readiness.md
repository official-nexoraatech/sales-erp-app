# 03 — Architecture Readiness

Verifies whether the intended layered model is actually implemented:

```
Tenant → Business Profile / Industry Classification → Capability / Feature Entitlements
       → Role / Permission → Capability-aware Navigation → Service-level enforcement
```

## A. Can a tenant represent different business types without a code fork?

**Yes, structurally — 4 verticals (Cloth Retail, Grocery, Distribution, Manufacturing) already share one codebase.** `tenants.vertical` remains the authoritative classification field (per the codebase's own ADR-01, `packages/db-client/src/schema/tenant.ts:46-48`); a newer `businessTypeId` FK (migration 0170) is an additive twin set once at tenant creation, not an ongoing sync. Business logic overwhelmingly reads a resolved **feature flag** (e.g. `manufacturing.bom.enabled`), not `tenant.vertical` directly — confirmed via grep, only one hardcoded `vertical === 'X'` runtime branch exists anywhere in the services sampled (`apps/accounting-service/src/domain/default-accounts.ts:724`, a single ternary for chart-of-accounts selection, rated LOW). This is the correct, scalable shape and it held up under real reuse: Distribution and Manufacturing both correctly extended the Phase 4 `industries`/`business_types` tables rather than requiring new mechanism.

## B/C. Can capabilities be enabled/disabled per tenant, with different sets per tenant?

**Yes, mechanically** — `featureFlags` rows are tenant-scoped, and `PlatformFeatureFlags`/`isCapabilityEnabled()` resolve per-tenant. But see `05-capability-entitlement-rbac.md`: the mechanism that enables/disables capabilities has a confirmed BLOCKER where a plan change can silently re-enable a capability a vertical had explicitly disabled.

## D. Can capabilities be enforced server-side?

**The mechanism can, and does for 3 of the capabilities that use it (POS, HR_PAYROLL, INVENTORY_BATCH) — but does not for the other 5 (all of Manufacturing's capabilities).** This is the audit's central finding — see `05-capability-entitlement-rbac.md` §3. "The mechanism exists and is well-built" and "business functionality is actually protected by it" are **not the same statement** for this codebase today, exactly as the audit brief warned against conflating.

## E. Can permissions independently restrict users inside an enabled capability?

**Yes, where both checks are wired together** — confirmed correct composition (capability-before-permission ordering) on every route that has both. Not applicable to Manufacturing routes since only the permission half exists there.

## F. Can the frontend hide/show functionality based on capability + permission?

**Yes.** `apps/web-frontend/src/lib/navigation.ts:974-988` (`filterNavItem`) checks capability then permission, centralized, single source of truth for both the sidebar and the command palette (`ERPCommandPalette.tsx:128` reuses the identical filter function). The code's own doc-comment states this is "UX filtering only... backend requireCapability() remains authoritative" — and that statement checks out everywhere except the Manufacturing gap (§D), where there is no backend authority to defer to. Route-level guarding (`PermissionRoute` in `App.tsx`) checks permission only, not capability, so direct URL navigation can render a capability-disabled page's shell — but since backend enforcement is real everywhere it exists, this is a UX rough edge, not a security hole, except where §D's gap means there's no backend check to catch it either.

## G. Does disabling a capability safely avoid mutating business data?

**Not independently verified in this pass** — no test or code path was found that runs data-mutation logic conditioned on capability state in a way that would corrupt data on toggle; capability checks gate route _access_, not data lifecycle. NOT VERIFIED as a dedicated claim; no counter-evidence found either.

## H. Does backend security remain correct if the frontend is bypassed?

**Yes, everywhere except Manufacturing.** This audit specifically hunted for routes where the _only_ protection is "the UI doesn't show a button" and found none for POS, HR_PAYROLL, or INVENTORY_BATCH — independent backend `requireCapability()` calls exist for all three, each backed by dedicated authz tests. For BOM/WORK_CENTERS/PRODUCTION_ORDER/ROUTING/MRP, there is no backend capability check to bypass _around_ — the gap is that no capability gate exists at all, only a permission gate, which is a different (and currently non-exploitable, since no default role grants the relevant permissions) but real problem. See `05-capability-entitlement-rbac.md`.

## I. Can a tenant have capabilities another tenant does not?

**Yes** — this is the normal, working case (e.g. a Cloth Retail tenant has no manufacturing flags set, a Manufacturing tenant does). Verified via `VERTICAL_DEFAULTS` templates and per-tenant `featureFlags` rows.

## J. Can new capabilities be added without redesigning the platform?

**Yes for the capability layer itself** (add a registry entry + a flag key + route guards — proven 8 times already). **No for the vertical/RBAC layer** — adding a wholly new _vertical_ (not just a capability within an existing one) requires code edits across 4 files (`05-capability-entitlement-rbac.md` §6), because `TenantVertical` is a closed union type, not a data-driven registry. This is a real but narrow gap: it means "add a 9th capability to Manufacturing" is config-shaped, but "add a 5th vertical (Hotel)" is code-shaped. Neither requires an architectural redesign; the second is simply more code than the first.

## Overall architecture verdict

The five-layer model is genuinely implemented as designed, not merely aspirational — every layer has real code behind it, and 3 of 5 wired capabilities prove the full chain works end-to-end. The gap is not in the architecture's design but in its **completeness of application** to the platform's own newest vertical. See `00-executive-verdict.md` for why this yields verdict C rather than B or A.
