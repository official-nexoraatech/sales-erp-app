# 06 — Entitlement Model

## 1. Current state (verified, not assumed — see `01-current-state.md` §21)

PG-027 Session 1 is **done**:

- `plan_entitlements` table (global, keyed by `plan`: `STARTER`/`GROWTH`/`ENTERPRISE`) — `max_users`, `max_branches`, `feature_flags jsonb[]`, `monthly_price_paise` (nullable, pricing undecided), `billing_period`. Migration `packages/db-client/migrations/0040_pg027_billing_entitlements.sql`.
- `tenants.settings.maxUsers`/`.maxBranches` — the tenant's actual copied limits.
- `BillingService.assignPlanEntitlements(tenantId, plan)` (`apps/tenant-service/src/domain/BillingService.ts`) — copies the plan template's limits + flags onto the tenant, advances `next_billing_date`.
- `assertUnderUserLimit`/`assertUnderBranchLimit` (`packages/platform-sdk/src/entitlements.ts`) — enforced with a Postgres advisory lock to prevent race conditions on concurrent user/branch creation.

**Not built** (PG-027 Sessions 2–3, explicitly out of scope for this initiative per the governing brief's "do not implement billing" instruction): `PaymentGatewayAdapter`, the `tenant-billing-cycle` scheduler job, billing admin routes/UI, and `createTenantContextMiddleware` registration (tenant suspension enforcement — currently a no-op; confirmed unregistered in any service's `main.ts`).

## 2. Three-way distinction (brief §19 requirement)

|              | Entitlement                                                                            | Feature Flag                                               | Permission                                   |
| ------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| Answers      | "What can this tenant's _plan_ commercially access?"                                   | "Is this specific behavior on for this tenant, right now?" | "Can this _user_ do this _action_?"          |
| Storage      | `plan_entitlements` (template) → copied into `tenants.settings` + `feature_flags` rows | `feature_flags` table                                      | JWT `permissions[]`, `PERMISSIONS` constants |
| Changes when | Plan changes (admin action)                                                            | Admin/ops toggle, or plan-copy                             | Role assignment changes                      |
| Granularity  | Plan-wide (seats, branches, module set)                                                | Per-tenant, per-key                                        | Per-user, per-action                         |

They are **not merged into one concept** — but entitlement and feature-flag intentionally **share one storage table** for the module-gating slice (`plan_entitlements.feature_flags` → tenant `feature_flags` rows), because that's the existing, working PG-027 design, and duplicating it into a second entitlement-storage mechanism would violate CLAUDE.md's Simplicity First principle. Numeric entitlements (seats/branches) are necessarily separate since they're not boolean.

## 3. How the Module/Capability model (`05-module-capability-model.md`) plugs in

`business_types.default_module_keys` (new, `04-domain-model.md`) determines what gets seeded at **provisioning**. `plan_entitlements.feature_flags` determines what the tenant's **commercial plan** allows. Both write to the same `feature_flags` table via the same tenant-override mechanism. A tenant's actual enabled-module set at any moment is the _intersection_ implicitly enforced by whichever wrote last (provisioning seeds first; a plan-change re-copy via `assignPlanEntitlements` can subsequently narrow or widen it). No new conflict-resolution logic is needed — this already matches how `assignPlanEntitlements`'s doc comment describes re-running it as authoritative ("re-copies the template, so a tenant's entitlements never silently drift from what the current plan grants").

**Recommendation, not built here:** when `plan_entitlements` gains new industry-specific modules (e.g. a `HOTEL` business type's `hospitality-rooms` module should probably only be available on `GROWTH`+ plans), that's a `plan_entitlements.feature_flags` seed-data decision at plan-design time — pure configuration, no code change.

## 4. What this plan explicitly does not do

- Does not build `PaymentGatewayAdapter` or the billing-cycle job (business decision + separate initiative, per PG-027's own doc and the governing brief).
- Does not register `createTenantContextMiddleware` (PG-012 — a distinct, already-identified gap, referenced but out of scope here).
- Does not add a fourth "capability-level" entitlement table — see `04-domain-model.md` §6 for why.
