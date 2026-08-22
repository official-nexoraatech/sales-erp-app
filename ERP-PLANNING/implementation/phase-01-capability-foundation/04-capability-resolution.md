# 04 — Capability Resolution

## 1. Exact runtime flow

```
Tenant (tenantId from request.auth, verified JWT — 01-current-code-evidence.md §1)
   │
   ▼
CAPABILITY_REGISTRY[key]  (in-process, code-defined, zero I/O — 03-capability-registry.md)
   │
   ▼
For each of [key.flagKey, ...key.requires' flagKeys transitively]:
   PlatformFeatureFlags(tenantScopedDb, tenantScopedCache, tenantId).isEnabled(flagKey)
      │
      ├── L1 (in-memory Map, 30s TTL, per-process) ──hit──▶ return
      ├── L2 (Redis, key `flags:${flagKey}`, 300s TTL) ──hit──▶ backfill L1, return
      └── DB (`feature_flags` WHERE tenant_id = X OR tenant_id IS NULL) ──▶ backfill L2+L1, return
   │
   ▼
Resolution outcome is now **three-way, not two-way** (corrected 2026-08-18, Decision 5 — see §5):
   │
   ├── ALL required flags resolve, all true  → Effective Capability = ENABLED  → next() (permission check follows, unchanged)
   ├── ALL required flags resolve, ≥1 false  → Effective Capability = DISABLED → 403 CAPABILITY_NOT_ENABLED
   └── Resolution itself could not complete   → Effective Capability = UNKNOWN  → 503 CAPABILITY_RESOLUTION_UNAVAILABLE
       (DB/Redis/infra/config failure — see 11-api-contracts.md for the full contract)
```

This is entirely the existing `PlatformFeatureFlags` mechanism (`01-current-code-evidence.md` §3) — capability resolution introduces zero new caching, zero new I/O, zero new invalidation path. `CAPABILITY_REGISTRY` is a pure in-process lookup (a JS object), effectively free.

## 2. Where capability state is loaded / cached

Nowhere new. State lives exactly where `feature_flags` data already lives, cached exactly where `PlatformFeatureFlags` already caches it (L1 in-memory 30s, L2 Redis 300s). This phase adds no new cache layer, no new TTL, no new invalidation channel.

## 3. Cache invalidation behavior

Unchanged — `PlatformFeatureFlags.invalidate(flagKey)` already clears L2 + local L1 + publishes to the `erp:feature-flags:invalidate` Redis pub/sub channel, and `subscribeToInvalidations()` already drops the matching L1 entry in every subscribed process (`01-current-code-evidence.md` §3). A capability's effective state becomes stale for at most the existing 30s L1 TTL after any flag it depends on is toggled via the existing `PUT /admin/feature-flags/:name` route (`apps/auth-service/src/routes/feature-flags.routes.ts`) — same staleness bound as every existing flag-gated behavior today, not a new risk introduced by this phase.

## 4. Tenant isolation

Identical to `PlatformFeatureFlags`'s existing guarantee: every lookup is scoped by `tenantId` derived from the verified JWT (`request.auth.tenantId`), never client-supplied, never cross-tenant by construction (`TenantScopedDatabase`/`TenantScopedCache` both take `tenantId` at construction and scope every query to it). No new isolation mechanism needed or introduced.

## 5. Failure behavior — fail-closed, with THREE distinct outcomes (CORRECTED 2026-08-18, Decision 5 — supersedes the two-outcome version of this section)

**Correction to the prior Decision 4 write-up**: fail-closed was correct, but collapsing "capability is disabled" and "capability state could not be determined" into the same `CAPABILITY_NOT_ENABLED`/403 outcome was wrong. They are different operational states — one is a definitive, successfully-resolved answer ("no"); the other is an infrastructure/configuration failure that prevented an answer at all. Both must still deny the request (fail-closed is unchanged as the governing principle), but they must be **distinguishable** in the response, so an operator can tell "this tenant's plan doesn't include this" apart from "the capability system itself is unhealthy right now."

**Decision, approved by the architect (Decision 5)**: three distinct resolution outcomes, each with its own contract:

1. **CAPABILITY DISABLED** — resolution _succeeded_ and definitively determined the capability is unavailable (the flag(s) resolved cleanly to `false`, or `CAPABILITY_REGISTRY[key]` lookup returns `undefined` for an unregistered key — a coding/config error must never silently grant access, so this is treated as a definitive "no," not an "unknown"). → `403 CAPABILITY_NOT_ENABLED`.
2. **PERMISSION DENIED** — capability is enabled, but the user's own permission check (the separate, independent `requirePermission` guard, `05-platform-sdk.md` §7) fails. → unchanged, existing live contract (`FORBIDDEN`, `11-api-contracts.md` §2b) — this phase does not touch `requirePermission` at all, and does not introduce a new code for this case.
3. **CAPABILITY RESOLUTION FAILURE** — the resolution call itself could not complete (DB connectivity failure, Redis unavailable, any unexpected exception anywhere in the `isCapabilityEnabled` call chain, or a configuration problem). Capability state is **unknown**, not "no." → `503 CAPABILITY_RESOLUTION_UNAVAILABLE`, and the request is still denied (fail-closed governs the _access decision_, not the _status code_ — see `11-api-contracts.md` §2c for the full contract). **This must never be reported as `CAPABILITY_NOT_ENABLED`/403** — doing so would misrepresent an infrastructure outage as a deliberate plan restriction, which is misleading to both the caller and to operators trying to distinguish the two situations from metrics/logs alone.

This still applies at every layer, defensively rather than assumed:

- A dependency (`requires`) that resolves to case 1 (cleanly disabled) makes the dependent capability case 1 too (transitively disabled, no separate code) — unchanged from the original design.
- A dependency whose _own_ resolution throws makes the dependent capability case 3 (resolution failure), not case 1 — the failure propagates as "unknown," not "no," consistent with the corrected semantics.
- `requireCapability`'s preHandler wraps its call to `isCapabilityEnabled` in an explicit `try/catch` specifically to implement this three-way split — see `05-platform-sdk.md` §2 for the updated code sketch.

**This still satisfies the governing-prompt's fail-closed requirement** — access is denied in both case 1 and case 3, with no exception. What changed is only that case 3 now gets its own, honest status code and error code rather than being folded into case 1's contract.

## 6. Service-to-service calls

Internal-key-guarded HTTP calls (the `x-internal-key` pattern, e.g. `gstComplianceProxy.ts`) are **system/service-account calls with no end-user tenant context to check a capability against in the same sense** — they're already a distinct trust tier from user-initiated requests. This phase does not add `requireCapability` to any internal-key route. If a future internal call genuinely needs tenant-capability awareness (e.g. "only proxy this GST action if the tenant has GST enabled"), that's evaluated case-by-case when that route is built — not a blanket rule from this phase.

## 7. Background jobs (scheduler-service)

Verified this session (`00-roadmap-analysis.md` evidence gathering): **no existing scheduled job checks `PlatformFeatureFlags` before running for a given tenant** — `tenantScoped: true` jobs iterate all `ACTIVE` tenants at startup with no entitlement/capability re-check (`apps/scheduler-service/src/main.ts:105-129`). This phase does **not** retrofit `requireCapability` into `JobRegistry` — that would be new, untested behavior change to a working system with no route-level precedent yet to model it on. Documented here as a known gap for a future phase to address once real route-level `requireCapability` usage (Phase 2, per the roadmap renumbering) has proven the pattern out. Recommendation for that future work: a job whose entire purpose is capability-specific (e.g. a future `hotel-nightly-audit` job that only makes sense for Hotel tenants) should check `isCapabilityEnabled` itself inside its per-tenant loop body and skip non-applicable tenants — not a `requireCapability`-style preHandler, since jobs have no Fastify request/reply cycle.

## 8. Kafka consumers

Verified this session: `apps/gst-service/src/consumers/InvoiceGstConsumer.ts` trusts `event.tenantId` unconditionally, with zero permission/flag check (`01-current-code-evidence.md` — evidence gathered separately, consumer reads `event.tenantId` directly and writes via `GstLedgerService.insertEntry`). This phase does **not** change consumer behavior. Rationale: an event only exists because the producing service's write-time route _already_ passed whatever authorization it required to create that event in the first place (e.g. an invoice was only confirmed because the confirming user had `INVOICE_CONFIRM` and, in a post-Phase-2 world, would have passed `requireCapability` too) — a consumer re-checking capability after the fact is redundant with write-time enforcement and risks a new failure mode (a capability toggled off between event-publish and event-consume silently drops/fails a downstream side-effect that the tenant already legitimately triggered). If a future review determines specific consumers need their own capability check (e.g. a consumer building a Hotel-specific projection that shouldn't run for non-Hotel tenants), that's scoped individually then, not decided as a blanket policy here.

## 9. Summary table

| Path                                          | Capability-checked in this phase?                   | Why                                                                            |
| --------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| HTTP route via `requireCapability` preHandler | Yes (mechanism built, not yet wired to real routes) | Primary use case                                                               |
| Internal `x-internal-key` service calls       | No                                                  | Different trust tier, system-initiated                                         |
| Scheduler jobs                                | No                                                  | No existing precedent; would need its own per-job design later                 |
| Kafka consumers                               | No                                                  | Write-time enforcement already covers it; re-checking risks a new failure mode |
