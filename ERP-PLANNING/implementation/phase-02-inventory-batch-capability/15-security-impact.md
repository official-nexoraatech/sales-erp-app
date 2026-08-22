# 15 — Security Impact

## 1. The genuine architectural pressure point this phase surfaces (per the brief's SIXTH section)

Phase 1's `requireCapability` was designed and tested exclusively as a **route-level preHandler** (`21-post-implementation-review.md` §3/§4 — every test proves the whole-route-denied case). This phase is the first to need a capability check **inside** an always-on route (`POST/PUT /items` — Commerce Core, never gateable as a whole route, per `03-target-architecture.md` §7 and `16-phase-roadmap.md` Phase 4's explicit scope). `05-service-impact.md` §1 resolves this by using the already-exported, already-tested `isCapabilityEnabled()` function directly rather than the `requireCapability` preHandler — but this is a **genuinely new usage pattern**, not previously proven at the route-handler level (Phase 1 only exercised `isCapabilityEnabled` from `GET /users/me`'s aggregate-computation context, not from inside a mutating route's validation logic). This phase's testing (`16-testing-strategy.md`) must prove this pattern is safe (fail-closed on resolution error here too — a DB/Redis outage during `POST /items` must not silently accept `fefoEnabled: true`) with the same rigor Phase 1 proved the preHandler pattern.

## 2. Fail-closed behavior in the new in-handler usage

`isCapabilityEnabled()` (Phase 1) can throw on resolution failure (its `try/catch` boundary lives in `requireCapability`, not inside `isCapabilityEnabled` itself — confirmed by reading `capability-guard.ts`: `isCapabilityEnabled` has no try/catch of its own). The new `item.routes.ts` call site must wrap its own call in a try/catch and **reject** `fefoEnabled: true` on any resolution error (never default to "assume enabled" on infra failure) — mirroring `requireCapability`'s own fail-closed design (`21-post-implementation-review.md` §3 point 3) rather than inventing a different failure mode for the in-handler case. This must be an explicit, tested code path, not an accidental side effect of unhandled-exception behavior.

## 3. The consumption-ordering trust decision (from `05-service-impact.md` §3), stated as a security tradeoff

`ValuationService.consumeFifoLayers()` trusts `items.fefoEnabled` as already-capability-gated, rather than re-resolving the capability on every stock consumption. This is **not** a security gap: `fefoEnabled` can only become `true` through a capability-checked write path (§1 of this document); a tenant cannot reach `true` any other way (no bulk-import path, no admin script found that writes this column outside `item.routes.ts` — confirmed by the same repo-wide grep in `01-current-code-evidence.md` §3 that found zero write sites at all currently). If the capability is later disabled for a tenant that already has `fefoEnabled: true` items, those items **continue** consuming FEFO-ordered (the column value, not live capability state, drives `ValuationService`) until explicitly toggled back off per item — a deliberate, documented product decision (§4 below), not an oversight.

## 4. Open decision, not resolved by this planning pass (per CLAUDE.md: present tradeoffs, don't silently pick)

**What should happen to already-`fefoEnabled: true` items if a tenant's `INVENTORY_BATCH` capability is later disabled (plan downgrade, admin toggle)?** Two reasonable options:

- **(a) Leave item-level flags as-is, let them keep behaving FEFO-ordered** (this phase's default, per §3) — simplest, no data migration, matches the general precedent that disabling a capability doesn't retroactively mutate existing configured state (e.g. disabling `HR_PAYROLL` doesn't delete existing payroll records).
- **(b) Force-revert all of a tenant's `fefoEnabled` items to `false` when the capability is disabled** — cleaner "capability off means fully off" semantics, but requires new code (a listener on flag-disable) that doesn't exist for any other capability today and would be new, not reused, infrastructure.

This plan recommends (a) for consistency with existing precedent and to avoid new infrastructure, but flags it here explicitly for confirmation before implementation — a genuine product decision, not purely technical.

## 5. Trust boundary — unchanged

No new trusted header, no gateway-level logic change, no change to JWT verification (`13-security-architecture.md` §1/§4 continue to hold unmodified). `tenantId` for every new check in this phase comes exclusively from the JWT-derived `request.auth`, same as every existing check.

## 6. What this phase does not do

Does not enable RLS. Does not add a new trust boundary. Does not change `TenantScopedDatabase`/`TenantScopedCache` behavior.
