# 01 — Current State: Architecture Discovery

Evidence-based. Every claim below is cited to a file, and where useful a line number or symbol. Gathered by direct repository inspection (not assumed from prior planning docs) on 2026-08-18. Where a prior memory/doc conflicts with what the code shows now, the conflict is called out explicitly (see §21).

## 1. Current architecture

Microservices, one deployable per bounded context, Fastify + Drizzle ORM + Zod, behind a single API gateway (`apps/api-gateway`), shared Postgres 16 (single instance, tenant_id-filtered, not database-per-tenant), Kafka for async events via a transactional outbox, Redis for cache/locks/pubsub, Elasticsearch for search, MinIO/S3 for object storage. 17 backend services + 3 frontends (`web-frontend`, `pos-frontend`, `customer-portal`) + `docs-site`. Shared code lives in `packages/` (`db-client`, `shared-types`, `platform-sdk` — published internally as `@erp/sdk`, `shared-utils`, `ui`, `design-tokens`, `logger`, `config`).

## 2. Current tenant model

`tenants` table (`packages/db-client/src/schema/tenant.ts:18-109`, DDL `packages/db-client/migrations/0000_worried_blue_marvel.sql:185-214`): `id` (bigserial PK, root — no `tenant_id` on this table itself, comment confirms "this IS the root"), `name`, `slug`, `status` (`PROVISIONING|ACTIVE|SUSPENDED|CLOSED`), `plan` (`STARTER|GROWTH|ENTERPRISE`), `vertical` (see §3), `contactEmail`, `gstin`, `pan`, `settings` (jsonb: `maxUsers`, `maxBranches`), plus billing/provisioning bookkeeping columns.

No Organization/Company-group table exists above tenant. `organization_settings` (`tenant.ts:112`) is itself tenant-scoped (one row per tenant — org-level _settings_, not an org _entity_ above tenant). **Confirms the brief's assumption**: tenant is correctly the root; no evidence justifies an Organization layer.

Hierarchy below tenant: Tenant → Branches → Warehouses, Users mapped to branches via `branchIds` in the JWT — matches the brief's stated model exactly.

## 3. Current business/vertical model

`tenants.vertical varchar(20) DEFAULT 'CLOTH_RETAIL' NOT NULL`, added by `packages/db-client/migrations/0164_tenants_vertical.sql:5`. TypeScript type restricts it to `'CLOTH_RETAIL' | 'GROCERY'` (`tenant.ts:36-39`) — DB column itself has no CHECK constraint, so it's a soft enum.

**Every real usage site** (confirmed by full-repo grep, not assumed):

- `apps/tenant-service/src/rbac/vertical-defaults.ts` — `VERTICAL_DEFAULTS` map: role exclusions + feature-flag overrides per vertical (today: GROCERY only disables `hr.tailoring.enabled`; no role differences yet — explicitly scaffolded, "populate further as vertical-specific roles/flags are built").
- `apps/tenant-service/src/api/tenant.schemas.ts:13` — signup/provisioning Zod validation.
- `apps/tenant-service/src/domain/TenantProvisioner.ts:78,305,422,520` — read once at provisioning to pick role defaults, feature-flag overrides, and chart-of-accounts template (`seedChartOfAccounts`).
- `apps/accounting-service/src/domain/default-accounts.ts:716-718` — picks `GROCERY_DEFAULT_ACCOUNTS` vs `DEFAULT_ACCOUNTS`.
- `apps/accounting-service/src/api/scheduler-internal.routes.ts:194` — same template selection, internal endpoint.

**Not used anywhere else** — zero hits in `web-frontend`, `pos-frontend`, or any other backend service at request time. `vertical` currently gates **only provisioning-time seeding**, nothing at runtime. This is the single most important finding for target-architecture design: there is no existing "vertical gates module visibility" mechanism to preserve or migrate — it has to be built new (§ `03-target-architecture.md`), and the 2-value enum needs to widen without breaking the 4 call sites above.

## 4. Current RBAC

Flat `RESOURCE_ACTION` string constants, `packages/shared-types/src/permissions.ts` — ~330 constants, organized into ~50 commented sections, with a real prefix-namespace convention already in practice (`CRM_*`, `HR_*`/`EMPLOYEE_*`/`PAYROLL_*`, `GSTR1_*`/`GSTR3B_*`/`GSTR9_*`, `PLATFORM_*`). No formal module-association field exists — the "module" is implicit in the string prefix only.

Role defaults: `apps/tenant-service/src/rbac/role-defaults.ts` — `ROLE_DEFAULTS: Record<string, Permission[]>`, one hardcoded array per system role (`OWNER`, `ADMIN`, `SALES_MANAGER`, `CASHIER`, `STORE_MANAGER`, `PURCHASE_MANAGER`, `ACCOUNTANT`, `INVENTORY_MANAGER`, `HR_MANAGER`, `STAFF`, `ACCOUNTANT_SUPERVISOR`, `AUDITOR`, `DATA_OFFICER`). Per-vertical variation exists only via `vertical-defaults.ts` (§3) layered on top, not a full per-vertical role rewrite.

Permissions are baked into the JWT at issuance (`AccessTokenPayload.permissions: string[]`, `apps/auth-service/src/jwt.ts:4-17`), not re-derived per-request from role — a role change requires re-issuing tokens (refresh).

## 5. Current navigation

`apps/web-frontend/src/lib/navigation.ts` (1024 lines) — static `NAV_GROUPS: NavGroup[]` array, each leaf `NavItem` with an optional single `permission`. No per-vertical or per-module branching exists anywhere in this file or `Layout.tsx`. Filtering is client-side only: `filterNavItem`/`filterNavGroups` (`navigation.ts:949-990`), consumed by `Layout.tsx:55,85`. No backend navigation endpoint exists — confirmed absent, and per the brief, none should be built.

## 6. Current authentication / authorization

JWT issued by `auth-service` (RS256 via `jose`), payload: `sub, tenantId, email, roles[], permissions[], branchIds[], impersonatedBy?, isImpersonation?, customerId?` (`apps/auth-service/src/jwt.ts:4-17`).

**Trust boundary is exactly as the brief assumes, and is enforced, not just documented**: `apps/api-gateway/src/middleware/gateway-auth.ts` explicitly never forwards tenant/user identity as a header — comment: "a service ever trusting an x-tenant-id header instead of its own JWT verification would be spoofable." Every downstream service independently calls `verifyAccessToken` and derives `request.auth` itself (e.g. `apps/sales-service/src/middleware/authenticate.ts`). The gateway does a coarse signature/expiry check purely for its own rate-limiter keying, and gates public paths via `EXEMPT_PATHS`/`EXEMPT_PREFIXES` — it does not authorize routes (no per-route permission table in the gateway).

## 7. Current authorization (module/capability layer)

Does not exist as a distinct layer. Authorization today is exactly: JWT permission array → `requirePermission(PERMISSIONS.X)` preHandler per route. There is no intermediate "is this module even enabled for this tenant" check anywhere — a tenant with HR disabled would still pass an `HR_VIEW` permission check if the role happened to grant it. Feature flags (§16) are the closest analog but are not wired into `requirePermission`.

## 8. Current database tenancy

Shared single Postgres instance (with a read replica, `ReplicaRouter` referenced in `report-service`), `tenant_id` column + explicit `WHERE` filter on every tenant-scoped table, enforced centrally by `TenantScopedDatabase` (`packages/platform-sdk/src/database.ts:6-60`) which auto-injects `tenantId` on insert and auto-filters on `findMany`. ~927 `tenant_id` references across 169 migration files, ~253 across 24 schema files — the large majority of transactional tables are tenant-scoped.

**RLS is designed, not enabled.** `infrastructure/docker/postgres/init.sql:35-46` defines a `current_tenant_id()` helper and documents the intended `USING (tenant_id = current_setting('app.current_tenant_id')::int)` policy pattern, but zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY` statements exist across all 169 migrations. `TenantScopedDatabase.transaction()` sets the `app.current_tenant_id` GUC, but only inside an explicit `.transaction()` block — `ES-36_COMPLETION.md` confirms most routes (e.g. `invoice.routes.ts`) never open one, so enabling RLS today would silently zero out the dominant non-transactional read path. This is a known, deliberately-deferred gap (architecture-audit finding M14), not an oversight this plan needs to rediscover. See `13-security-architecture.md`.

## 9. Current service boundaries

17 backend services: `accounting`, `ai-copilot`, `api-gateway`, `auth`, `automation`, `crm` (scaffold only, see below), `event`, `gst`, `hr`, `inventory`, `notification`, `production`, `purchase`, `report`, `sales`, `scheduler`, `search`, `tenant`.

**Known boundary problem, already identified and in progress**: `sales-service` is a "God service" — hosts core Order-to-Cash _and_ the entire CRM roadmap (leads, opportunities, campaigns, journeys, territories, quotas, tickets, referrals, field sales, CTI) in one deployable (`multi_vertical_grocery_audit_2026_08_16`, `reportsengine_dedup_and_crm_split_2026_08_16`). `apps/crm-service` was scaffolded 2026-08-16 (commit `cc9627f`) as the target split destination — bare Fastify bootstrap, health/metrics only, **zero domain routes registered** (`main.ts` TODO comment: "CRM route registrations land here as domain files move from sales-service"). The full migration plan (file inventory, 4 coupling-point decisions) exists but is **not executed** — see `reportsengine_dedup_and_crm_split_2026_08_16` memory for the complete plan. This matters directly for multi-industry planning: a "CRM/Support" capability that spans a physical service boundary mid-migration needs the module/capability model to not assume 1 module = 1 service.

## 10. Current event architecture

Transactional outbox: `apps/event-service/src/outbox/OutboxRelayWorker.ts` polls `outbox_events` (`FOR UPDATE SKIP LOCKED`), publishes to Kafka, marks `published`/`failed`, dead-letters to `dlqItems` after max retries with an admin replay surface (`apps/event-service/src/api/dlq.routes.ts`). Schema Registry (`schema-registry.routes.ts`), Event Store (`event-store.routes.ts`), Saga Orchestrator (`packages/platform-sdk/src/saga.ts`, only wired for GST-compliance proxying today via `gstComplianceProxy.ts`), and Projections (`projections.routes.ts`) all exist as real, distinct components.

Event naming: `EventTypes` const + topic derivation `erp.${eventType.toLowerCase().replace('_','.')}` (`OutboxRelayWorker.ts:153`, types in `packages/shared-types/src/events.ts`). Envelope (`ERPEventPayload`) already carries `eventId, eventType, schemaVersion, aggregateType, aggregateId, tenantId, userId, correlationId, causationId, occurredAt, payload` — i.e. **all the governance fields section 11 of the brief asks for already exist on every event**. There is no separate written "event governance doc" beyond the type definitions themselves, but the mechanism is sound.

## 11. Current workflow architecture

**Two distinct, both-live engines** (not one dormant as some prior planning assumed — reverified directly):

- `WorkflowExecutionEngine` (`apps/automation-service/src/domain/WorkflowExecutionEngine.ts`) — trigger/condition/action automation, Kafka-event-driven, subscribes to all `EventTypes` topics.
- `WorkflowEngine` (`packages/platform-sdk/src/workflow.ts`) — DB-driven **approval workflow** engine (definitions/instances/approvals), wired into `PurchaseOrderService`, `InvoiceService`, `tenant-service`'s approval routes and `TenantProvisioner`.

Both share one condition evaluator (`rule-engine.ts`'s `evaluateCondition`) after a prior consolidation — they remain two purposes (approval chains vs. automation triggers), correctly separate per the brief's §13 guidance, not accidentally duplicated.

## 12. Current reporting architecture

Direct-DB read model, not Kafka-fed projections: `apps/report-service/src/domain/ReportEngine.ts` (2472 lines) queries Postgres (likely via `ReplicaRouter`, a read replica) with raw Drizzle SQL. **The historically-duplicated Trial Balance/P&L/Balance Sheet/Cash Flow logic is now consolidated**: `packages/platform-sdk/src/financial-reports-engine.ts`'s `ReportsEngine` class is the single source of truth as of 2026-08-16 (`d7de8ca`); `apps/accounting-service/src/domain/ReportsEngine.ts` is now a 1-line re-export shim, and `report-service`'s 4 financial-statement branches call the same shared engine. (This corrects the stale `report_service_reportengine_split` memory, which predates the dedup.)

## 13. Current search architecture

`apps/search-service/src/domain/SearchEngine.ts` — 29 indexed entity types (customer, item, invoice, stock, employee, crm_interaction/segment/campaign, journal_entry, etc.). Tenant isolation is **physical, index-name-based**: `` `erp_${tenantId}_${entity}` ``, not merely a query-time filter (`SearchEngine.ts:541` and 8 other call sites). This is a strong isolation guarantee, and directly usable for new industries: a new entity type is a new index-name suffix, no cross-tenant risk by construction.

## 14. Current audit architecture

Two distinct pipelines, correctly separated per the brief's §16 ask:

- **Business/data audit**: `audit_log` table (`packages/db-client/src/schema/index.ts:66-87`), append-only, `before_data`/`after_data`/`changed_fields`/`actor_email`, written via shared `PlatformAuditLogger` (`packages/platform-sdk/src/audit.ts`) across services.
- **Security audit**: `security_audit_log` table (`packages/db-client/src/schema/auth.ts:166-199`), typed enum action (`IMPERSONATION_START/END`, `MFA_*`, `SESSION_TERMINATED`, `SUSPICIOUS_LOGIN`, `LOGIN_SUCCESS/FAILURE`, `ROLE_ASSIGNED`, etc.), written exclusively by `auth-service`.

## 15. Current configuration architecture

`feature_flags` table: per-tenant override over global default (`tenant_id IS NULL` row = default), flat dotted-key namespace (`pos.enabled`, `hr.payroll.enabled`, `gst.e-invoice.enabled`, `multi-branch.enabled`, ~20+ keys seeded across `0022_es28_seed_feature_flag_defaults.sql` and `TenantProvisioner.seedFeatureFlags`). `tenants.settings` jsonb also carries ad hoc tenant config (`maxUsers`, `maxBranches`). No formal "business configuration" layer beyond these two — no per-module config schema, no UI-driven tenant configuration screen beyond `organization_settings` and individual admin pages.

## 16. Current feature flag architecture

`PlatformFeatureFlags` (`packages/platform-sdk/src/feature-flags.ts`) — 2-tier cache: L1 in-memory `Map` (30s TTL, per-process), L2 Redis (300s TTL, key `flags:${flagKey}`), DB fallback. Lookup: L1 → L2 → DB → backfill. Invalidation: `invalidate()` clears L2 + local L1 + publishes to Redis pub/sub channel `erp:feature-flags:invalidate`; `subscribeToInvalidations()` drops the matching L1 entry in every subscribed process — genuine cross-instance hot-reload, no restart needed. This is a mature, production-grade primitive and is the natural mechanism to build module/capability gating on top of (see `05-module-capability-model.md`).

## 17. Current API architecture

Gateway routing: `apps/api-gateway/src/config.ts` `UPSTREAM_DEFAULTS` — 16 upstreams, `{service, envVar, defaultPort, apiV2}`, proxied via `@fastify/http-proxy` at `prefix: /api/<service>`. **API versioning is real and enforced** for 12/16 services (`apiV2: true` → `rewritePrefix: /api/v2`); `report`, `production`, `event` remain unversioned by explicit choice, legacy unprefixed paths kept reachable during a stated deprecation window. **Both frontends route through the gateway** — `web-frontend/src/api/client.ts` and `pos-frontend`'s fetch bases both default to gateway port 3000, not individual service ports (this corrects a prior memory note — `pg010_api_versioning_completion` — that suggested frontends bypass the gateway; current code shows they do not).

## 18. Current frontend architecture

3 frontends (`web-frontend`, `pos-frontend`, `customer-portal`) + `docs-site`, each independently deployed (no Dockerfile for frontends — likely static-build deployed separately from the 16 containerized backend services). Domain logic is backend-resident; frontends consume it via the gateway. No shared business-logic-in-frontend anti-pattern detected in this pass.

## 19. Current testing architecture

Vitest for unit/integration (`turbo run test` at root, `vitest run --passWithNoTests` per service), Playwright for e2e (`apps/web-frontend/e2e/` — 36 specs, `apps/pos-frontend/e2e/` — 5 specs; no top-level e2e directory, e2e lives per-frontend). 272 unit test files across `apps/*/src/__tests__`, unevenly distributed (`sales-service` 73, `web-frontend` 1 — consistent with `full_architecture_audit_2026_07_31`'s note that `inventory-service`/`purchase-service`/`auth-service` are thinnest by file-ratio; `auth-service` being security-critical is the more concerning gap).

## 20. Current deployment architecture

Per-service Docker images (16 `apps/*/Dockerfile`) + per-service K8s manifests (`infrastructure/k8s/*.yaml`) + Helm chart (`infrastructure/helm/erp`) + Istio policies (`infrastructure/istio`). Root `docker-compose.yml` provisions infra only: Postgres primary+replica, PgBouncer, Redis, Zookeeper+Kafka, MinIO, Elasticsearch, Jaeger, Loki, Prometheus/Alertmanager/Grafana/Pushgateway, Mailhog, Vault, backup job. Genuinely microservices, not monolithic — a new industry's service(s) fit this pattern directly (one more Dockerfile + K8s manifest + gateway upstream entry).

## 21. Discrepancies found vs. prior assumptions (brief §36 compliance)

| Assumption                                                                                 | Evidence found                                                                                                                                                                                        | Correct interpretation                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontends may bypass the gateway (PG-010 memory)                                           | `client.ts`/`pos-frontend` both default to gateway port 3000                                                                                                                                          | Frontends route through the gateway; no fix needed here                                                                                                                           |
| Two separate P&L/BS/TB engines still diverged (`report_service_reportengine_split` memory) | Consolidated into `platform-sdk/financial-reports-engine.ts` 2026-08-16, both services now consume it                                                                                                 | Memory is stale; already fixed                                                                                                                                                    |
| `WorkflowEngine` in platform-sdk might be "dormant" (prior audit note)                     | Both engines actively wired into PurchaseOrderService, InvoiceService, tenant-service approval routes                                                                                                 | Not dormant — two live, correctly-separated engines                                                                                                                               |
| PG-027 (subscription/billing) gap-prompt doc says "zero subscription/billing code exists"  | `plan_entitlements`/`tenant_invoices` tables, `BillingService.assignPlanEntitlements()`, and entitlement-limit enforcement (`packages/platform-sdk/src/entitlements.ts`) already exist and are tested | Gap-prompt doc predates this work; Session 1 of PG-027 is done, Sessions 2–3 (payment gateway, billing-cycle job, admin UI, `createTenantContextMiddleware` registration) are not |

No discrepancies found against the brief's core assumptions (tenant-as-root, no Organization layer, JWT-only trust, RESOURCE_ACTION naming) — all were confirmed correct by direct inspection.
