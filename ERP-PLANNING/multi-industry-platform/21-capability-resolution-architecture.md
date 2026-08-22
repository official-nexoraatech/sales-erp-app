# 21 — Capability Resolution Architecture

Status: Proposed. This document refines (does not contradict) `03-target-architecture.md`, `04-domain-model.md`, `05-module-capability-model.md`, `07-rbac-model.md`, `08-navigation-model.md`. Written in response to a structured review of the discovery/plan (docs 00–20), which endorsed the overall direction but asked for one governing mechanism to be made explicit before any implementation is authorized: **how does Nexoraa decide, at runtime, whether a tenant can use a capability — and who is allowed to ask that question safely?**

Nothing in this document requires new infrastructure. Every layer it describes already exists (`PlatformFeatureFlags`, `plan_entitlements`/`BillingService`, JWT-per-service verification, `RESOURCE_ACTION` RBAC). What's new is the explicit contract connecting them, and one small shared library function every service calls the same way.

---

## 1. Terminology — Capability, not Module vs. Capability

The review correctly flagged a risk: a two-level Module → Capability hierarchy (`04-domain-model.md`'s original framing) invites exactly the kind of rigid taxonomy the brief warns against, and doesn't match reality — `feature_flags` is already a flat namespace, and some gates are coarse (`pos.enabled`) while others are fine (`gst.e-invoice.enabled`) with no structural difference between them.

**Revised terminology (supersedes the Module/Capability split in `04-domain-model.md`/`05-module-capability-model.md` — those docs' _mechanism_ is unchanged, only this naming layer is refined):**

- **Capability** — the one concept. A named, gateable unit of product functionality, coarse or fine-grained, always backed 1:1 by a `feature_flags.flag_key`. `POS`, `MANUFACTURING`, `INVENTORY_BATCH`, `MULTI_UOM`, `LOYALTY` are all capabilities — there is no separate "module" tier above them in storage or enforcement. A capability MAY declare other capabilities as prerequisites (`INVENTORY_BATCH` might require `INVENTORY`) — composition, not hierarchy.
- **Module** — kept only as a _UI/documentation grouping label_ (which nav group, which section of the capability registry doc a capability appears under) — never a runtime gate itself. This matches how `NAV_GROUPS` already groups nav items without those groups being a separate enforcement layer.
- **Service** — a deployable. A capability's implementation may live inside one service, span several, or (per the review's explicit point) not correspond to any single service at all. `MANUFACTURING` capability does not imply a `manufacturing-service`; today `POS` capability is implemented partly in `sales-service` and partly in `pos-frontend`. **Rule: never infer service boundaries from the capability list, and never infer the capability list from the service list.**

## 2. The Effective Capability formula

Per the review's model, adopted as-is:

```
Effective Capability Set(tenant) =
    Business Profile's Default Capabilities
      ∩ (bounded by)
    Subscription Entitlement's Allowed Capabilities   [plan_entitlements.feature_flags]
      ⊕ (overridden by, admin action)
    Tenant-specific Feature Flag overrides            [feature_flags WHERE tenant_id = X]

Effective Access(user, capability, action) =
    capability ∈ Effective Capability Set(tenant)      -- CAPABILITY layer
      AND
    permission ∈ user's JWT permissions[]               -- PERMISSION layer (existing, unchanged)
```

These are evaluated as **two independent, ordered gates**, never merged into one check — this is the same distinction `07-rbac-model.md` already establishes for the permission/module boundary, generalized to the capability vocabulary. A user can hold `PRODUCTION_ORDER_CREATE` permission (their role grants it) while `MANUFACTURING` is not in the tenant's effective capability set — that fails the capability gate, not the permission gate, and should produce a distinguishable error (`CAPABILITY_NOT_ENABLED` vs `PERMISSION_DENIED`) so the frontend can render "not part of your plan" vs. "you don't have access" correctly — exactly as `07-rbac-model.md` §4 already specifies.

### Layer authority (answers the review's "who owns entitlement truth" question)

| Layer                                 | Single source of truth                                                                                   | Who writes it                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Business Profile default capabilities | `business_types.default_module_keys` (rename in v1 implementation to `default_capability_keys` — see §7) | Seed data, admin-curated, rarely changes                                           |
| Subscription entitlement              | `plan_entitlements.feature_flags`                                                                        | `tenant-service`'s `BillingService` only                                           |
| Tenant-specific override              | `feature_flags` rows with `tenant_id` set                                                                | Platform admin action, or `BillingService.assignPlanEntitlements()` on plan change |
| Effective set (computed)              | Not stored — computed per-lookup by `PlatformFeatureFlags`                                               | N/A (derived)                                                                      |

**Explicit rule, addressing the review's §11 concern directly: `BillingService` (tenant-service) is the only writer of entitlement-derived capability state.** No other service, no frontend, and no ad hoc admin script writes to a tenant's capability-relevant `feature_flags` rows outside `BillingService.assignPlanEntitlements()` or a documented platform-admin toggle route that itself calls into the same service. This prevents the review's feared outcome ("billing knows some features, tenant-service knows some, feature flags know some, frontend knows some").

## 3. Where enforcement lives — defense in depth, not gateway-only

The review is correct to flag this as the most consequential open decision, and correct about the answer: **given the existing security model (every service independently re-verifies the JWT and must remain safe if called directly, `01-current-state.md` §6), the gateway cannot be the only capability-enforcement point.** A gateway-only check would mean any service, if reached directly (misconfigured network policy, a compromised adjacent pod, a debugging session against a raw service port), would honor requests for capabilities the tenant doesn't have.

**Decision: capability enforcement is a `packages/platform-sdk` function, called by each service's own route preHandler chain — the same pattern `requirePermission` already uses.**

```
packages/platform-sdk/src/capability-guard.ts   (new file)

export function requireCapability(capabilityKey: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const flags = new PlatformFeatureFlags(request.db, request.cache, request.auth.tenantId);
    const enabled = await flags.getValue(capabilityKey);
    if (!enabled) {
      throw new BusinessError('CAPABILITY_NOT_ENABLED', `This tenant's plan does not include ${capabilityKey}.`, { capabilityKey });
    }
  };
}
```

Route registration, identical pattern to today's permission guard:

```ts
fastify.post(
  '/production-orders',
  {
    preHandler: [
      authenticate,
      requireCapability('MANUFACTURING'),
      requirePermission(PERMISSIONS.PRODUCTION_ORDER_CREATE),
    ],
  },
  handler
);
```

This reuses `PlatformFeatureFlags`'s existing cache (in-memory 30s + Redis 300s) — no new caching layer, no new network hop, no gateway involvement, and it is safe under direct-to-service calls by construction (the same reason `requirePermission` is safe today).

**The gateway's role stays exactly what it is today** (`01-current-state.md` §6, §17): coarse JWT sig/expiry check for its own rate-limiter keying, `EXEMPT_PATHS` gating for public routes, request proxying with real API versioning. It gains no new capability logic — adding any there would create a second, parallel enforcement path that could drift from the service-level one, which is the exact anti-pattern the review is warning against.

### Why not a shared middleware registered once at each service's app-level, instead of per-route?

Considered and rejected: not every route in a service needs a capability check (Commerce Core routes — Sales, Inventory, Accounting — are always-on per `16-phase-roadmap.md` Phase 4's explicit scope, matching `03-target-architecture.md` §7's "what does NOT change"). A blanket app-level middleware would need its own per-route exemption list, which is strictly more bookkeeping than opting individual route trees in via `preHandler`, and diverges from how `requirePermission` already works (declared per-route, not globally).

## 4. Capability Registry Governance

Adopting the review's proposed schema, implemented as a code-defined registry (continuing `04-domain-model.md`'s "code, not DB" decision — capabilities ship with code, so a DB-editable registry would be a lie about what's actually deployed):

```ts
// packages/shared-types/src/capability-registry.ts

export interface CapabilityDefinition {
  key: string; // 'INVENTORY_BATCH' — SCREAMING_SNAKE_CASE, matches the flag key's semantic (flag key itself stays dotted-lowercase per existing convention, e.g. 'inventory.batch.enabled' — see naming bridge below)
  domain: string; // 'Inventory' — which bounded context conceptually owns this
  owningService: string; // 'inventory-service' — where the enforcement/behavior actually lives
  requires: string[]; // ['INVENTORY'] — prerequisite capabilities, composition not hierarchy
  introducedPhase: string; // 'Phase 7' — traceability back to this planning set
  status: 'GA' | 'BETA' | 'DEPRECATED';
  applicableBusinessTypes: string[]; // ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING'] — documentation only, not an enforcement input
  permissions: string[]; // ['BATCH_VIEW', 'BATCH_CREATE', 'BATCH_ADJUST'] — cross-reference into permissions.ts, not a new permission source
}

export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  INVENTORY_BATCH: {
    key: 'INVENTORY_BATCH',
    domain: 'Inventory',
    owningService: 'inventory-service',
    requires: ['INVENTORY'],
    introducedPhase: 'Phase 7',
    status: 'BETA',
    applicableBusinessTypes: ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING'],
    permissions: ['BATCH_VIEW', 'BATCH_CREATE', 'BATCH_ADJUST'],
  },
  // one entry per capability, added incrementally as each is built — never speculatively pre-registered
};
```

### Naming convention (prevents the review's feared `BATCH`/`BATCH_TRACKING`/`LOT_TRACKING` drift)

- **Capability key**: `SCREAMING_SNAKE_CASE`, singular domain noun or noun phrase, no verb (`INVENTORY_BATCH`, not `TRACK_BATCHES` or `BATCH_TRACKING`).
- **Feature flag key** (the actual DB-backed toggle): existing dotted-lowercase convention, `domain.capability.enabled` (`inventory.batch.enabled`) — the registry entry is the single documented bridge between the two naming schemes; no capability may exist without exactly one corresponding flag key, and no new flag key may be introduced for capability-gating purposes without a registry entry (this is a code-review convention, not a runtime-enforced rule — enforcing it at runtime would be over-engineering for what's fundamentally a naming-hygiene concern).
- **One registry entry, one PR.** A capability is proposed and registered in the same change that first makes it gateable — never registered speculatively ahead of the code that implements it (this mirrors `04-domain-model.md` §4's existing "never all at once" instruction for `MODULE_REGISTRY`, now generalized to `CAPABILITY_REGISTRY`).

## 5. Worked example 1 — Grocery tenant, POS sale with loyalty points

```
Tenant: "Fresh Mart" (business_type = GROCERY, plan = GROWTH)
   │
   ├─ Business Profile: industry=COMMERCE, business_type=GROCERY
   │     default capabilities seeded at provisioning: POS, INVENTORY, SALES,
   │     ACCOUNTING, GST, LOYALTY  (from business_types.default_capability_keys,
   │     itself migrated 1:1 from today's VERTICAL_DEFAULTS content — 15-migration-strategy.md)
   │
   ├─ Subscription Entitlement: GROWTH plan_entitlements.feature_flags includes
   │     'pos.enabled', 'sales.loyalty.enabled', 'gst.e-invoice.enabled', ...
   │     → BillingService.assignPlanEntitlements() copied these onto Fresh Mart's
   │       tenant-scoped feature_flags rows at provisioning
   │
   ├─ Feature Flag override: none active — tenant runs the plan defaults as-is
   │
   ├─ Effective Capability Set: { POS, INVENTORY, SALES, ACCOUNTING, GST, LOYALTY }
   │
   ├─ User: cashier "Priya", role CASHIER
   │     JWT permissions[] includes POS_SALE_CREATE, LOYALTY_POINTS_REDEEM (from ROLE_DEFAULTS)
   │
   ├─ Request: POST /api/sales/pos/checkout  { ..., redeemLoyaltyPoints: 50 }
   │     → api-gateway: JWT sig/expiry check only, proxies to sales-service
   │     → sales-service authenticate.ts: verifies JWT locally, sets request.auth
   │     → requireCapability('POS'): PlatformFeatureFlags.getValue(tenantId, 'pos.enabled') → true → pass
   │     → requireCapability('LOYALTY') on the redeem sub-path: 'sales.loyalty.enabled' → true → pass
   │     → requirePermission(POS_SALE_CREATE): present in JWT → pass
   │     → requirePermission(LOYALTY_POINTS_REDEEM): present in JWT → pass
   │     → handler executes, invoice + loyalty ledger entry created in one transaction (existing LoyaltyService↔POS coupling, per reportsengine_dedup_and_crm_split_2026_08_16 — unaffected by this doc)
   │
   ├─ Navigation: web-frontend session payload includes enabledCapabilities: ['POS','INVENTORY','SALES','ACCOUNTING','GST','LOYALTY']
   │     → filterNavItem checks the LOYALTY-tagged nav sub-item's capabilityKey against this set → visible
   │     → a hypothetical MANUFACTURING nav group (not in this tenant's set) → hidden, even if some
   │       role at Fresh Mart happened to be granted PRODUCTION_* permissions by mistake
   │
   └─ AI Copilot: Priya asks the copilot "how many loyalty points does customer X have?"
         → copilot's ToolRegistry proxies through api-gateway using Priya's own JWT (unchanged, 01-current-state.md)
         → the underlying tool call hits the same sales-service loyalty route, which runs the
           identical requireCapability('LOYALTY') + requirePermission(LOYALTY_VIEW) chain
         → capability enforcement is NOT duplicated inside ai-copilot-service — it is inherited
           for free because every tool call is a real authenticated HTTP call through the same
           guarded routes. No new AI-specific capability logic is needed (confirms 13-security-architecture.md §4).
```

## 6. Worked example 2 — Distribution tenant, batch-tracked stock transfer

```
[Correction, 2026-08-18: the "Phase 7 must land before Distribution gets batch/UOM" framing below is now historical — that work already shipped, see 02-gap-analysis.md G8's correction note. The trace still illustrates the resolution mechanism correctly; only the "why does Apex have these capabilities" framing is now inaccurate.]

Tenant: "Apex Distributors" (business_type = DISTRIBUTION, plan = ENTERPRISE)
   │
   ├─ Business Profile: industry=COMMERCE, business_type=DISTRIBUTION
   │     default capabilities: SALES, PURCHASE, INVENTORY, INVENTORY_BATCH,
   │     MULTI_UOM, ACCOUNTING, GST, CRM  (DISTRIBUTION's default_capability_keys —
   │     a NEW business_types row authored at Phase 10, reusing Commerce Core's
   │     existing SALES/PURCHASE/INVENTORY/ACCOUNTING/GST/CRM capabilities as-is,
   │     per 19-first-industry-recommendation.md's reuse thesis)
   │
   ├─ Subscription Entitlement: ENTERPRISE plan_entitlements.feature_flags includes
   │     everything, including 'inventory.batch.enabled' and 'inventory.multi-uom.enabled'
   │     (these two capabilities exist only because Phase 7 — Commerce Core
   │     generalization — landed before Phase 10, per 16-phase-roadmap.md's
   │     explicit reordering; a STARTER-plan Distribution tenant might NOT have
   │     INVENTORY_BATCH even though its business type defaults suggest it,
   │     if the plan's entitlement doesn't include it — entitlement bounds
   │     business-type defaults, per the §2 formula, not the other way around)
   │
   ├─ Effective Capability Set: { SALES, PURCHASE, INVENTORY, INVENTORY_BATCH,
   │     MULTI_UOM, ACCOUNTING, GST, CRM }
   │
   ├─ User: warehouse manager "Raj", role INVENTORY_MANAGER
   │     JWT permissions[] includes STOCK_TRANSFER_CREATE, BATCH_ADJUST
   │
   ├─ Request: POST /api/inventory/stock-transfers  { ..., batchNumber: 'B2026-08', uom: 'CASE' }
   │     → inventory-service: requireCapability('INVENTORY_BATCH') → checks
   │       CAPABILITY_REGISTRY['INVENTORY_BATCH'].requires = ['INVENTORY'] is
   │       ALSO satisfied (both flags true) → pass
   │     → requireCapability('MULTI_UOM') → pass
   │     → requirePermission(STOCK_TRANSFER_CREATE) → pass
   │     → handler executes using the Commerce Core UOM-conversion logic built
   │       in Phase 7 (multi_vertical_grocery_audit_2026_08_16's Phase 1 scope) —
   │       the SAME code path a Grocery tenant's case↔piece conversion uses.
   │       This is the review's §9 point made concrete: Grocery's batch/UOM work
   │       is reused verbatim by Distribution, not reimplemented.
   │
   └─ Reporting: a new "Batch Aging Report" (industry-agnostic — useful to
         Grocery, Distribution, and Pharmacy alike) is gated the same way:
         report-service's route for that report slug carries
         requireCapability('INVENTORY_BATCH') before requirePermission(REPORT_VIEW),
         consuming the projection strategy recommended in 11-reporting-architecture.md
         for new analytical work — not a retrofit of the existing 83 report slugs.
```

## 7. Consequential renames this doc introduces (deferred to implementation, not executed here)

To keep `04-domain-model.md`/`05-module-capability-model.md` and this document terminologically consistent once implementation begins:

- `business_types.default_module_keys` → `default_capability_keys` (same column, renamed before first use — no data exists yet, zero migration cost if done before Phase 1 ships).
- `MODULE_REGISTRY` (`04-domain-model.md` §4) and `MODULE_PERMISSION_PREFIXES` (`07-rbac-model.md` §2) → superseded by the single `CAPABILITY_REGISTRY` in §4 above (its `permissions` field already carries what `MODULE_PERMISSION_PREFIXES` was for).
- `requireModule()` (`05-module-capability-model.md` §5, `16-phase-roadmap.md` Phase 3–4) → `requireCapability()` (§3 above) — same mechanism, renamed for consistency.
- `moduleCode` field on `NavItem`/`NavGroup` (`08-navigation-model.md` §2) → `capabilityKey`.

None of these renames change the underlying design decided in docs 03–09 (feature-flags as the storage mechanism, additive/inert rollout, no new tables) — they only replace the two-tier Module/Capability vocabulary with the single flat Capability vocabulary this document establishes, per §1.

## 8. What this document does not introduce

- No new database table (capability state is still `feature_flags`; the registry is still code).
- No gateway-level authorization logic (enforcement stays per-service, per §3).
- No capability↔service coupling rule beyond "don't assume one" (§1).
- No change to the JWT shape, the RBAC permission list, or the entitlement/billing scope boundary already established in `06-entitlement-model.md`.
- No implementation — this remains a planning document. Per the review's own recommendation, the next action is user sign-off on this resolution model, not code.
