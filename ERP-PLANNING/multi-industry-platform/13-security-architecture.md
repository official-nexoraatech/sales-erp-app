# 13 — Security / Tenant Isolation Strategy

## 1. Trust boundary — preserve exactly as-is

Confirmed correct and enforced (`01-current-state.md` §6): gateway never forwards `x-tenant-id`/`x-user-id`/`x-business-type` headers; every service independently verifies the JWT and derives tenant/user/permission context itself (`apps/api-gateway/src/middleware/gateway-auth.ts`'s own comment explicitly documents the spoofing risk of the alternative). **This plan introduces no new trusted header of any kind.** Any new module/capability context (`enabledModules`) is either re-derived per-service from the tenant's own `feature_flags` state (via `PlatformFeatureFlags`, already tenant-scoped and DB-backed) or carried inside the JWT if genuinely needed at the edge — never a bare forwarded header.

## 2. Tenant isolation — current reality and a bounded recommendation

**Current**: application-level only. `TenantScopedDatabase` auto-filters `WHERE tenant_id = ?` on `findMany`/auto-injects on insert; ~927 tenant_id references across migrations confirm broad (not universal-by-proof) coverage. RLS is designed (`infrastructure/docker/postgres/init.sql`) but not enabled — `ES-36_COMPLETION.md` found that enabling it today would break the dominant non-transactional read path, since `app.current_tenant_id` is only set inside explicit `.transaction()` blocks and most routes don't open one.

**Recommendation (evidence-based, not auto-implemented per brief §9)**:

1. Close the GUC-per-request gap first: set `app.current_tenant_id` at connection-checkout time (a pool-level `afterCreate`/per-request hook), not only inside explicit transactions. This is a prerequisite, independently valuable even before RLS (makes the GUC reliably available for any future use), and is a bounded, mechanical change.
2. Only then enable RLS, table-by-table, starting with the highest-value/highest-risk tables (financial: invoices, journal entries, payments), each rollout monitored for query-plan regressions and zero-row false negatives before proceeding to the next table.
3. Do not treat RLS as a prerequisite for multi-industry work — it's an orthogonal hardening track that becomes more valuable as tenant count and new-service surface grow, but nothing in the module/capability/Business-Profile model depends on it.

This matches `ES-36`'s own stated next step and does not invent new urgency beyond what the existing audit already identified.

## 3. Module/capability context does not weaken isolation

The new `requireModule()` preHandler (`05-module-capability-model.md`) reads `PlatformFeatureFlags` scoped to the JWT-derived `tenantId` — same trust chain as every existing permission check, no new attack surface. A malicious or buggy client cannot claim a different tenant's enabled-module set because the tenantId it's evaluated against is never client-supplied.

## 4. AI Copilot — confirmed already correct, cite as a preserved strength

`ai-copilot-service` proxies every tool call through the gateway using the _caller's own JWT_ (`ToolRegistry.ts`), never runs raw SQL, never accesses the DB directly (`01-current-state.md` §6 sub-agent findings). As new industries add copilot-accessible data, this pattern continues to be the enforcement point — no new AI-specific authorization layer is needed; the existing per-user JWT proxy already scopes every AI action to what that user could do anyway.

## 5. What this plan does not do

Does not enable RLS as part of this initiative (recommendation only, sequenced dependency on the GUC fix). Does not introduce trusted headers. Does not change the JWT-verification-per-service model. Does not weaken any existing isolation mechanism (index-per-tenant search, S3 tenant-prefixed keys) to accommodate new industries — all confirmed compatible as-is.
