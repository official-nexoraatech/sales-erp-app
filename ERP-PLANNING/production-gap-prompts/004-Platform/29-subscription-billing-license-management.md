# [PG-027] Subscription/Billing/License Management

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Platform
**Priority:** Medium
**Complexity:** XL — net-new domain (plans, entitlements, invoicing-to-tenant, payment-gateway integration, a recurring billing-cycle job) with no existing code to extend; touches tenant-service, scheduler-service, notification-service, and both frontends; several sub-decisions are business decisions, not engineering ones (see Overview).
**Depends on:** PG-012 (tenant suspension/closure enforcement) — billing-driven suspension (dunning → grace period → suspend) is only meaningful once a suspended tenant is actually locked out of the app; today `createTenantContextMiddleware` exists but is never registered, so wiring billing-based suspension on top of a no-op enforcement layer would ship a feature that looks like it works but doesn't.
**Blocks:** PG-028 (usage tracking feeds usage-based billing tiers)
**Primary service(s)/package(s):** apps/tenant-service, apps/scheduler-service, apps/notification-service, packages/db-client, packages/shared-types, apps/web-frontend

---

## Overview

- **This is the largest, most business-decision-dependent package in the entire 58-package backlog.** Before any implementation session picks this up, the assumptions below marked "CONFIRM WITH PRODUCT OWNER" must actually be confirmed — this document proposes a workable v1 shape, it does not invent business requirements (pricing, plan names, payment gateway choice) on the user's behalf. Treat everything in this file as a starting proposal for a conversation, not a spec ready to build blind.

- **Business objective:** Today this ERP runs as if every tenant is a hosted-per-customer deployment — there is no way to charge for it, meter it, or cut off a non-paying tenant automatically. To operate this as a real multi-tenant SaaS product (as opposed to bespoke installs billed manually/offline), the platform needs: (1) a plan/tier model, (2) entitlements tied to a plan (seats, branches, feature access), (3) a recurring billing cycle that produces invoices for tenant owners, (4) a way to collect payment, and (5) a way to degrade/suspend a tenant that stops paying. None of this exists today.

- **Current implementation:** Confirmed by direct grep across `apps/tenant-service`, `apps/*/src`, and `packages/*/src` for `subscription|billing|license` (case-insensitive): the only hits are `billingAddress` JSON fields on customer/supplier records in `packages/db-client/src/schema/master.ts` (unrelated — a shipping/invoicing address field, not a billing-*system*) and the same field surfacing in `apps/sales-service/src/api/customer.routes.ts`/`supplier.routes.ts` Zod schemas and `web-frontend` customer pages. **Zero subscription, billing-cycle, invoice-to-tenant, or license/seat-limit code exists anywhere.** This confirms the assumption given at the start of this work: there is genuinely nothing to extend here, only patterns to reuse.

- **Current architecture:** The `tenants` table (`packages/db-client/src/schema/tenant.ts`) already carries a `plan` column (`varchar`, default `'STARTER'`, typed as `'STARTER' | 'GROWTH' | 'ENTERPRISE'`) — set at provisioning time via `TenantProvisioner.provision()` (`apps/tenant-service/src/domain/TenantProvisioner.ts:74`, `input.plan ?? 'STARTER'`) and never read anywhere else in the codebase (confirmed by grep: no route, service, or middleware ever checks `tenants.plan`). It is a label with no behavior behind it. The `tenants.settings` jsonb column also already declares (but never populates or reads) `maxBranches?: number` and `maxUsers?: number` (`packages/db-client/src/schema/tenant.ts:67-68`) — these look like they were scaffolded for exactly this kind of entitlement work and then never wired up.

- **Current limitations:** No plan-to-entitlement mapping exists; `plan` is decorative. No invoice/billing-cycle concept exists for tenants (as distinct from the `invoices` table, which is a customer sales document inside a tenant's own books — do not confuse the two; this package must not touch `sales-service`'s `invoices` table). No payment gateway is integrated anywhere. No mechanism ties a tenant falling behind on payment to `tenants.status` (which already supports `SUSPENDED`/`CLOSED` via `TenantProvisioner.suspend()`/`.close()`).

## Existing Code Analysis

- **What already exists and should be reused:**
  - `tenants.plan` column and the `'STARTER' | 'GROWTH' | 'ENTERPRISE'` union — reuse as the plan-tier foreign concept; do not invent a parallel "tier" column.
  - `tenants.settings.maxBranches` / `.maxUsers` — reuse these as the entitlement-limit storage for seat/branch caps; they are already typed and already flow through `TenantProvisioner`'s settings write at provisioning (`apps/tenant-service/src/domain/TenantProvisioner.ts:78-82`).
  - `PlatformFeatureFlags` (`packages/platform-sdk/src/feature-flags.ts`) — tenant-scoped, global-default-fallback, L1 (in-memory 30s) + L2 (Redis 300s) cached, hot-invalidatable via Redis pub/sub. This is the **existing entitlement-enforcement mechanism** and must be reused rather than building a second flags/entitlements system (see Architecture).
  - `TenantProvisioner.suspend()` / `.activate()` / `.close()` (`apps/tenant-service/src/domain/TenantProvisioner.ts:404-442`) — the state-transition primitives a billing-driven suspension flow should call into, not duplicate.
  - `JobRegistry` (`apps/scheduler-service/src/JobRegistry.ts`) — BullMQ + Redis distributed lock (`SET NX EX`) + 3-attempt exponential backoff pattern already used for all 31 scheduler jobs. The billing-cycle job (invoice generation, dunning) must be registered here, not run as a bespoke cron/setInterval inside tenant-service.
  - `PlatformEventBus` / outbox pattern (`packages/platform-sdk/src/events.ts`) — `publish()`/`publishInTransaction()` write to the `outboxEvents` table inside the same DB transaction as the domain write, then the event-service outbox relay (500ms poll, `SELECT...FOR UPDATE SKIP LOCKED`) publishes to Kafka. Any new billing-lifecycle event (`TENANT_INVOICE_GENERATED`, `TENANT_PAYMENT_RECEIVED`, `TENANT_SUBSCRIPTION_SUSPENDED`) must go through this, not a direct Kafka client.
  - `notification-service`'s existing SendGrid/MSG91/WhatsApp integrations and Handlebars per-(tenant,event-type,channel) templates — reuse for invoice/dunning/receipt emails; do not build a second notification pipeline.
  - `PLATFORM_TENANT_MANAGE` permission + `PLATFORM_OPERATOR` role (`packages/shared-types/src/permissions.ts:388`, seeded once in `packages/db-client/migrations/0020_es21_platform_operator.sql`) — reuse this single platform-level permission for the new billing-admin routes in v1 rather than minting a second platform permission; split into a narrower `PLATFORM_BILLING_MANAGE` only if a future need for finer-grained platform-team roles actually materializes.
  - `apps/web-frontend/src/pages/admin/TenantsPage.tsx` + the "PLATFORM ADMIN" nav group (`apps/web-frontend/src/lib/navigation.ts:216-219`) — the natural place to add a "Billing" tab/section, not a new top-level admin app.

- **What should never be modified:** `sales-service`'s own `invoices`/`payments` tables and routes (tenant-internal sales documents) — a tenant-billing invoice is a conceptually distinct entity and must live in tenant-service's own schema, not overload the sales module's tables. `TenantProvisioner`'s existing 9-step flow must not be reordered; a 10th step (assign default plan entitlements) should be additive at the end, following the same `markStep()`/`provisioningStatus` pattern already established (see PG-029 for the related S3-step fix, which touches the same file — sequence these two packages' file edits carefully to avoid merge conflicts if run in parallel sessions).

- **Prior related work:** None. This is genuinely first-touch — no completion report or audit doc references billing/subscription work. `ES-21_COMPLETION.md` (PLATFORM_OPERATOR seeding) and `ES-20_COMPLETION.md` (feature flags/audit/attachments) are the closest adjacent prior work and are referenced above for their reusable primitives only.

## Architecture

- **Assumption to confirm — plan tiers and pricing (CONFIRM WITH PRODUCT OWNER):** this plan assumes the existing `STARTER`/`GROWTH`/`ENTERPRISE` three-tier structure is retained (it is already the column's type), with illustrative-only entitlement shapes below. **No price point, currency, billing period (monthly vs. annual), or trial-period length is specified here** — those are commercial decisions this document deliberately does not make.
- **Assumption to confirm — payment gateway (CONFIRM WITH PRODUCT OWNER):** this is a business decision (contract terms, settlement currency, India-specific compliance like RBI/PCI scope) as much as a technical one. Candidates given this is an India-first GST-compliant ERP: Razorpay or Stripe (Stripe India support is limited for domestic cards). **Do not pick one and start integrating without this confirmation** — the architecture below is written provider-agnostic (a `PaymentGatewayAdapter` interface) specifically so the choice can be deferred without blocking the rest of the design.
- **Entitlement model:** Add a `plan_entitlements` table (global, not tenant-scoped — it defines what each plan *tier* grants, not what a specific tenant has) keyed by `plan` (`STARTER`/`GROWTH`/`ENTERPRISE`), holding `max_users`, `max_branches`, and a `feature_flags` jsonb array of flag keys granted at that tier (e.g. `GROWTH` includes `gst.e-invoice.enabled`, `hr.payroll.enabled`; `STARTER` does not). A tenant's *actual* limits still live on `tenants.settings.maxUsers`/`.maxBranches` (already-existing columns) — `plan_entitlements` is the template copied into a tenant's `settings` at provisioning/plan-change time, exactly the same "template → tenant copy" shape `ROLE_DEFAULTS` already uses for roles (`apps/tenant-service/src/rbac/role-defaults.ts`). This avoids a tenant's limits silently changing out from under them if the plan's default entitlements are edited later — an explicit plan-change action re-copies the template, matching how role-seeding already works.
- **Feature-flag reuse as the enforcement mechanism:** Do not invent a second "entitlement check" system. At plan-assignment time (provisioning, or an explicit plan-change admin action), copy the plan's `feature_flags` array into `feature_flags` rows for that tenant via the existing `PlatformFeatureFlags`/`featureFlags` table — i.e., a `GROWTH`-plan tenant simply has `gst.e-invoice.enabled=true` written as a tenant-specific override row. Every route that already gates on a feature flag (e.g. e-invoice generation) transparently becomes plan-gated with no new code in those routes. Seat/branch caps (`maxUsers`/`maxBranches`) are numeric, not boolean, so they cannot be modeled as feature flags — these need one new small check (`requireEntitlement('maxUsers')`-style preHandler or a helper called at user/branch creation, see Backend) that compares the current count against `tenants.settings.maxUsers`/`maxBranches`.
- **Billing-cycle job:** A new `apps/scheduler-service` job, `tenant-billing-cycle`, registered in `JobRegistry` (`tenantScoped: false`, since it iterates all `ACTIVE`/`SUSPENDED` tenants itself — it is a platform-level job, not a per-tenant one, so it does not fit the existing per-tenant-job convention exactly; document this as a deliberate one-off exception in the job's own registration comment). Runs daily; for any tenant whose `next_billing_date` (new column, see Database Changes) has passed, generates a `tenant_invoices` row (status `PENDING`), attempts payment via the `PaymentGatewayAdapter` if the tenant has a saved payment method, and on success marks it `PAID` + advances `next_billing_date` by the plan's billing period; on failure, starts (or advances) a dunning sequence (configurable grace period, e.g. 7 days — **confirm with product owner**) and emits a `TENANT_PAYMENT_FAILED` event; if the grace period elapses unpaid, calls `TenantProvisioner.suspend()` with `reason: 'PAYMENT_OVERDUE'`.
- **Component interactions and data flow:**
  1. Platform operator provisions/changes a tenant's plan → tenant-service copies `plan_entitlements` template into `tenants.settings` + `feature_flags` rows, and sets `next_billing_date`.
  2. Daily `tenant-billing-cycle` scheduler job scans due tenants → creates a `tenant_invoices` row → calls `PaymentGatewayAdapter.charge()` → outcome recorded → outbox event emitted.
  3. `notification-service` consumes the outbox event (new `TENANT_INVOICE_GENERATED`/`TENANT_PAYMENT_FAILED`/`TENANT_PAYMENT_RECEIVED` types) → sends email to the tenant's `contactEmail` using a new Handlebars template, same pattern as every other notification.
  4. If overdue past grace period → `TenantProvisioner.suspend()` is called → `createTenantContextMiddleware` (once PG-012 lands and is actually registered) blocks that tenant's users.
  5. Platform-admin frontend (`TenantsPage.tsx`, new "Billing" tab) shows plan, current entitlement usage (users/branches vs. cap — pairs with PG-028), invoice history, and a manual "retry payment"/"change plan" action gated on `PLATFORM_TENANT_MANAGE`.

## Database Changes

- **New table `plan_entitlements`** (global — no `tenant_id`, since it defines the tier template, not a tenant instance):
  - `id bigserial PK`, `plan varchar(50) UNIQUE NOT NULL` (`STARTER`/`GROWTH`/`ENTERPRISE`), `max_users integer NOT NULL`, `max_branches integer NOT NULL`, `feature_flags jsonb NOT NULL DEFAULT '[]'`, `monthly_price_paise integer` (nullable — **left nullable deliberately; pricing is not decided, see Architecture**), `billing_period varchar(20) NOT NULL DEFAULT 'MONTHLY'` (`MONTHLY`/`ANNUAL`), `created_at`, `updated_at`.
- **New table `tenant_invoices`** (tenant-scoped, `tenant_id NOT NULL`, following the repo's explicit-filter multi-tenancy convention — no RLS):
  - `id bigserial PK`, `tenant_id integer NOT NULL`, `plan varchar(50) NOT NULL` (snapshot of plan at invoice time — plans can change later, invoice must not silently change with it), `amount_paise integer NOT NULL`, `currency varchar(3) NOT NULL DEFAULT 'INR'`, `status varchar(20) NOT NULL DEFAULT 'PENDING'` (`PENDING`/`PAID`/`FAILED`/`VOID`), `billing_period_start date NOT NULL`, `billing_period_end date NOT NULL`, `payment_gateway_ref varchar(200)` (nullable — the external charge/payment-intent ID), `paid_at timestamptz`, `failure_reason text`, `created_at`, `updated_at`.
  - Indexes: `idx_tenant_invoices_tenant (tenant_id, status)`, `idx_tenant_invoices_billing_period (tenant_id, billing_period_start)`.
- **`tenants` table additions:** `next_billing_date date`, `dunning_started_at timestamptz` (nullable — null means not currently in dunning), `payment_gateway_customer_ref varchar(200)` (nullable — the gateway's saved-customer/payment-method token, never store raw card data — see Security).
- **Migration approach:** New file `packages/db-client/migrations/0035_pg027_billing_entitlements.sql`, sequential after `0034_organization_theme_config.sql` (the latest existing migration at time of writing — re-check the actual latest number before authoring, since concurrent packages may add migrations first). Follows the repo's plain-SQL migration convention (see any `00xx_*.sql` file for style — `CREATE TABLE IF NOT EXISTS`, explicit `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for the `tenants` additions). Seed the three existing plan tiers' `plan_entitlements` rows in the same migration (illustrative values only, pending product confirmation — e.g. `STARTER: max_users=5, max_branches=1`; `GROWTH: max_users=25, max_branches=5`; `ENTERPRISE: max_users=NULL (unlimited), max_branches=NULL`).
- **Rollback strategy:** All new tables — drop is safe and reversible (`DROP TABLE tenant_invoices; DROP TABLE plan_entitlements;`). New `tenants` columns are additive/nullable except `next_billing_date`, which should be nullable too (a tenant with no billing cycle configured yet, e.g. mid-migration, must not accidentally trip the scheduler job — the job should skip rows where `next_billing_date IS NULL`). No existing column is modified, so no data-loss risk on rollback.

## Backend

- **New routes (tenant-service, gated `PLATFORM_TENANT_MANAGE`, matching the existing `PLATFORM_ADMIN` preHandler tuple in `apps/tenant-service/src/api/tenant.routes.ts:17-20`):**
  - `GET /admin/tenants/:id/billing` — current plan, entitlement usage, `next_billing_date`, dunning status.
  - `PATCH /admin/tenants/:id/plan` — change plan; re-copies `plan_entitlements` template into `tenants.settings` + `feature_flags`, resets `next_billing_date` per new plan's billing period.
  - `GET /admin/tenants/:id/invoices` — paginated `tenant_invoices` history.
  - `POST /admin/tenants/:id/invoices/:invoiceId/retry-payment` — manual retry, calls `PaymentGatewayAdapter.charge()` again.
- **New service:** `apps/tenant-service/src/domain/BillingService.ts` — owns entitlement-template copy, invoice generation, and delegates payment calls to a `PaymentGatewayAdapter` interface (`charge(tenantId, amountPaise, customerRef): Promise<{success: boolean; gatewayRef: string; failureReason?: string}>`) so the concrete gateway (Razorpay/Stripe/other — **pending confirmation**) is a swappable implementation behind one interface, not scattered through route handlers.
- **New scheduler job:** `tenant-billing-cycle` in `apps/scheduler-service/src/jobs/system-jobs.ts` (or a new `billingJobs.ts` file if `system-jobs.ts` is already large — check current file length before deciding), registered via `JobRegistry.register()` following the exact pattern in `apps/scheduler-service/src/JobRegistry.ts:34-85` (distributed lock, 3-attempt backoff already built in — no new retry logic needed).
- **Events/Kafka:** New event types `TENANT_INVOICE_GENERATED`, `TENANT_PAYMENT_RECEIVED`, `TENANT_PAYMENT_FAILED`, `TENANT_SUBSCRIPTION_SUSPENDED` — published via `PlatformEventBus.publish()` (outbox pattern, never direct Kafka), consumed by `notification-service` for tenant-owner emails. Topic naming follows the existing `erp.<event.type>` convention (event-service's outbox relay derives topic names from event type automatically — no new topic-registration step needed).
- **Validation:** Zod schemas for the new routes, same convention as `apps/tenant-service/src/api/tenant.schemas.ts` (`CreateTenantSchema`, `SuspendTenantSchema` — mirror that file's style for `ChangePlanSchema`, etc.).
- **Authorization:** All new admin routes gated `PLATFORM_TENANT_MANAGE` via the existing `PLATFORM_ADMIN` preHandler tuple — do not invent a new permission for v1 (see Architecture).
- **Idempotency:** `PaymentGatewayAdapter.charge()` calls must be idempotent from the gateway's side (pass an idempotency key derived from `tenant_invoices.id`, same SHA-256-derived-idempotency-key pattern `notification-service` already uses for delivery dedup) — a scheduler job retry (e.g. after a pod restart) must never double-charge a tenant.
- **Telemetry:** New Prometheus counters `erp_tenant_invoice_generated_total`, `erp_tenant_payment_failed_total` (labelled `plan`), following the `getOrCreateCounter` idempotent-registration pattern already established in `packages/logger/src/erp-metrics.ts` — do not use `new Counter(...)` directly (it throws "already registered" under repeated Vitest imports, as documented in that file's own header comment).

## Frontend

- **Extend `apps/web-frontend/src/pages/admin/TenantsPage.tsx`** with a "Billing" tab per tenant: current plan (with a "Change Plan" action), entitlement usage bars (users X/Y, branches X/Y — reuse whatever stat-tile/meter component the design system already provides, do not build a new one), and an invoice history table (reuse the existing `DataTable` component convention used elsewhere in the admin pages).
- **Permission gating:** the entire Billing tab is already behind the page-level `PLATFORM_TENANT_MANAGE` gate (the page itself is already gated — see `apps/web-frontend/src/lib/navigation.ts:218`); no new frontend permission constant needed.
- **State management:** follow whatever data-fetching convention `TenantsPage.tsx` already uses (check the file directly before implementing — do not introduce a second fetching pattern).

## API Contract

- `GET /admin/tenants/:id/billing` → `200 { data: { plan, entitlements: { maxUsers, currentUsers, maxBranches, currentBranches }, nextBillingDate, dunningStartedAt } }`
- `PATCH /admin/tenants/:id/plan` → body `{ plan: 'STARTER'|'GROWTH'|'ENTERPRISE' }` → `200 { data: { message, tenantId, plan } }`; `404` if tenant not found; `400` if plan value invalid.
- `GET /admin/tenants/:id/invoices?page=&pageSize=` → `200 { data: { content: TenantInvoice[], totalElements } }` (mirrors the existing `GET /admin/tenants` pagination shape in `apps/tenant-service/src/api/tenant.routes.ts:57-65`).
- `POST /admin/tenants/:id/invoices/:invoiceId/retry-payment` → `200 { data: { status: 'PAID'|'FAILED', gatewayRef? } }`; `409 BusinessError('INVOICE_ALREADY_PAID', ...)` if already paid.
- All routes: `401` if unauthenticated, `403` if missing `PLATFORM_TENANT_MANAGE`, matching every existing `/admin/tenants*` route's error shape exactly.

## Multi-Tenant Considerations

- `tenant_invoices` carries `tenant_id NOT NULL`, queried with explicit `WHERE tenant_id = ?` everywhere — no RLS, matching the rest of the schema (per the Enterprise Architecture Guidance's stated convention).
- `plan_entitlements` is intentionally **not** tenant-scoped — it is a global plan-tier template, analogous to how `ROLE_DEFAULTS` is a global (in-code, not DB) template copied per tenant at provisioning. Do not add a `tenant_id` column to it.
- Feature-flag entitlement rows written per tenant (`tenant_id` non-null override rows in the existing `feature_flags` table) — this is exactly the existing tenant-override mechanism `PlatformFeatureFlags.fetchFromDb()` already reads (tenant-specific row takes precedence over the `tenant_id IS NULL` global default), so no change to that class is needed.
- The `PLATFORM_OPERATOR` role remains scoped to the reserved `platform-operations` tenant only (per `ES-21_COMPLETION.md`) — this package's admin routes must continue to require `PLATFORM_TENANT_MANAGE` and must never be reachable via any ordinary tenant-scoped role, even `OWNER`/`SUPER_ADMIN` (which already enumerate every *tenant-scoped* permission but explicitly exclude this one — see `apps/tenant-service/src/rbac/role-defaults.ts:7-9`).

## Integration

- **tenant-service:** owns `BillingService`, the new routes, and the `plan_entitlements`/`tenant_invoices` tables.
- **scheduler-service:** runs the `tenant-billing-cycle` job via `JobRegistry`.
- **notification-service:** consumes the four new outbox event types to send tenant-owner emails (invoice generated, payment received, payment failed/dunning warning, subscription suspended) — reuses existing SendGrid integration and Handlebars template-per-event-type convention; add four new templates.
- **event-service:** no code change — the existing outbox relay generically publishes any event type to `erp.<event.type>`; new event types need no relay-side registration.
- **web-frontend:** `TenantsPage.tsx` Billing tab (platform operators only).
- **Not touched:** sales-service, purchase-service, accounting-service, inventory-service, gst-service, hr-service, production-service, search-service, pos-frontend, auth-service — none of these have a natural touchpoint for platform-level billing.

## Coding Standards

- Fastify + Zod + Drizzle, matching every existing tenant-service route.
- `requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE)` preHandler, reusing the existing `PLATFORM_ADMIN` tuple constant rather than redefining it.
- `@erp/logger` (`createLogger`) for structured logs, matching `TenantProvisioner`'s existing `logger.info(...)` calls.
- OTel spans via `PlatformContext.trace()` if `BillingService` is built to consume a `PlatformContext` (check whether tenant-service already uses `PlatformContextFactory` or its own lighter-weight DB wiring before deciding — `TenantProvisioner`'s constructor currently takes a raw `ErpDatabase`, not a `PlatformContext`, so confirm which pattern this service actually follows before introducing a different one for `BillingService`).
- Prometheus counters via `getOrCreateCounter`/`getOrCreateGauge` from `packages/logger/src/erp-metrics.ts` — do not call `new Counter(...)` directly.
- **Genuinely novel to this package:** the `PaymentGatewayAdapter` interface has no precedent elsewhere in the codebase (no external payment integration exists at all today). This is justified — there is no existing pattern to reuse for "call a third-party payment API," and inventing one now, provider-agnostically, is the correct scope-minimal approach rather than hard-coding a specific SDK's calls directly into `BillingService`.

## Performance

- Daily billing-cycle job scans tenants where `next_billing_date <= now()` — index `idx_tenants_next_billing_date` should be added (`ALTER TABLE tenants ADD COLUMN next_billing_date date; CREATE INDEX ...`) so this scan doesn't full-scan the `tenants` table as tenant count grows.
- `tenant_invoices` pagination on the admin UI follows the existing `page`/`pageSize` convention used elsewhere (check `apps/tenant-service/src/api/tenant.schemas.ts` or the org-settings routes for the exact query-param shape already established, and reuse it rather than inventing a new pagination contract for this one endpoint).
- No expected concurrency/locking concern beyond what the scheduler job's existing Redis distributed lock (`JobRegistry`) already provides — the billing-cycle job runs once per day per tenant by construction (guarded by `next_billing_date`), so double-billing risk is bounded by the idempotency key on `charge()`, not by locking.

## Security

- **No raw payment card data is ever stored** — only the gateway's tokenized `payment_gateway_customer_ref`/`payment_gateway_ref` (opaque strings from the provider). This keeps the platform out of PCI-DSS card-data scope; if the chosen gateway's SDK ever surfaces raw card fields to this codebase, that is a red flag the implementation has gone wrong.
- `PLATFORM_TENANT_MANAGE`-gated on every admin route — no new permission surface to audit beyond what `ES-21` already locked down.
- Webhook endpoint (if the chosen payment gateway uses webhooks for async payment confirmation, which most do) must verify the gateway's signature header before trusting the payload — this is the one new genuinely-external-facing surface this package introduces and needs its own explicit signature-verification code path, not reuse of the internal `x-internal-key` service-to-service pattern (that pattern is for service-to-service calls within this monorepo's trust boundary, not for an external webhook).
- Rate limiting: reuse `@fastify/rate-limit`, already a tenant-service dependency (`apps/tenant-service/package.json`), on the new routes — no new rate-limit mechanism needed.

## Testing

- **Unit:** `BillingService` entitlement-copy logic (plan template → tenant settings + feature flags), invoice-amount calculation, dunning-state transition logic — new `apps/tenant-service/src/__tests__/billing-service.test.ts`.
- **Integration:** billing-cycle job end-to-end against a real (or `describe.skipIf(!DATABASE_URL)`-gated) Postgres — tenant due for billing → invoice created → mock `PaymentGatewayAdapter` success → `next_billing_date` advanced; mock failure → dunning started → grace period elapsed → `TenantProvisioner.suspend()` called with `reason: 'PAYMENT_OVERDUE'`.
- **Route-level:** `fastify.inject()` tests for all four new routes — 403 without `PLATFORM_TENANT_MANAGE`, 200 with it, following the exact pattern in `apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts`.
- **Idempotency test:** simulate a scheduler-job retry (same `tenant_invoices.id`) and assert `PaymentGatewayAdapter.charge()` is called with the same idempotency key and does not double-charge.

## Acceptance Criteria

- [ ] `plan_entitlements` table exists with seeded rows for `STARTER`/`GROWTH`/`ENTERPRISE` (values pending product confirmation, placeholder-seeded per this doc in the interim).
- [ ] Changing a tenant's plan via `PATCH /admin/tenants/:id/plan` visibly updates `tenants.settings.maxUsers`/`.maxBranches` and the tenant's `feature_flags` override rows — verifiable via `SELECT` immediately after the call.
- [ ] A tenant with `next_billing_date` in the past is picked up by the next `tenant-billing-cycle` job run and produces exactly one `tenant_invoices` row (verify via manual job trigger, same `POST /scheduler/jobs/:name/trigger`-style manual-trigger endpoint scheduler-service already exposes for other jobs).
- [ ] A failed payment starts dunning (`dunning_started_at` set); after the configured grace period with no successful retry, the tenant's `status` becomes `SUSPENDED` with `suspendedReason: 'PAYMENT_OVERDUE'` — verifiable via `SELECT status, suspended_reason FROM tenants`.
- [ ] All four new routes return `403` for a caller without `PLATFORM_TENANT_MANAGE` and succeed for one with it.
- [ ] No raw card/payment-method data appears in any new table or log line (manual grep of the new migration + `BillingService` for field names like `cardNumber`/`cvv`).

## Deliverables

- **Files to create:**
  - `packages/db-client/migrations/0035_pg027_billing_entitlements.sql`
  - `apps/tenant-service/src/domain/BillingService.ts`
  - `apps/tenant-service/src/api/billing.routes.ts`
  - `apps/tenant-service/src/domain/PaymentGatewayAdapter.ts` (interface + one concrete implementation once the gateway is chosen)
  - `apps/scheduler-service/src/jobs/billingJobs.ts` (or an addition to `system-jobs.ts` — decide based on current file size)
  - `apps/tenant-service/src/__tests__/billing-service.test.ts`
  - Four new notification templates in `notification-service` (invoice-generated, payment-received, payment-failed, subscription-suspended).
- **Files to modify:**
  - `packages/db-client/src/schema/tenant.ts` (new columns), `packages/db-client/src/schema/index.ts` (new tables, if that's where table exports are centralized — confirm against the actual export location used for `featureFlags`/`sagaLog`).
  - `apps/tenant-service/src/domain/TenantProvisioner.ts` (10th provisioning step: assign default plan entitlements — additive, after `SET_FEATURE_FLAGS`).
  - `apps/tenant-service/src/main.ts` (register `billing.routes.ts`).
  - `apps/web-frontend/src/pages/admin/TenantsPage.tsx` (Billing tab).
- **Migrations:** `0035_pg027_billing_entitlements.sql` (exact number pending — re-verify the latest existing migration number at implementation time).
- **APIs added/changed:** `GET/PATCH /admin/tenants/:id/billing`, `PATCH /admin/tenants/:id/plan`, `GET /admin/tenants/:id/invoices`, `POST /admin/tenants/:id/invoices/:invoiceId/retry-payment`.
- **Events added/changed:** `TENANT_INVOICE_GENERATED`, `TENANT_PAYMENT_RECEIVED`, `TENANT_PAYMENT_FAILED`, `TENANT_SUBSCRIPTION_SUSPENDED`.
- **Tests added:** `billing-service.test.ts`, billing-cycle job integration test, route-level authz tests for all 4 new routes, idempotency test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** The ERP is a 14-service Fastify/Drizzle/Kafka monorepo currently operated as if every tenant is a manually-billed, hosted-per-customer install. `tenant-service` already provisions tenants (9-step checkpointed flow), manages lifecycle (suspend/activate/close), and stores a `plan` label (`STARTER`/`GROWTH`/`ENTERPRISE`) that nothing reads. `tenants.settings` already declares unused `maxUsers`/`maxBranches` fields. No subscription/billing/payment code exists anywhere — confirmed by grep, not assumed.

**Current Objective:** Build a v1 commercial-operation layer: a plan-entitlement template table, per-tenant entitlement enforcement (seat/branch caps + feature-flag gating), a daily billing-cycle scheduler job that generates tenant invoices and attempts payment via a swappable gateway adapter, and dunning → suspension on non-payment.

**Architecture Snapshot:**
1. Multi-tenancy is enforced entirely in application code (`tenant_id` + explicit `WHERE` filters) — no Postgres RLS, no per-tenant schema.
2. `PlatformFeatureFlags` (packages/platform-sdk/src/feature-flags.ts) is the existing tenant-scoped, cached, hot-invalidatable flag system — reuse it as the entitlement-enforcement mechanism, don't build a second one.
3. All async work goes through the outbox pattern (`PlatformEventBus.publish()` → `outboxEvents` table → event-service's Kafka relay) — services never publish to Kafka directly.
4. `JobRegistry` (scheduler-service) is the only scheduled-job mechanism — BullMQ + Redis distributed lock + built-in retry/backoff.
5. `PLATFORM_TENANT_MANAGE` is the one existing platform-level permission, held only by `PLATFORM_OPERATOR` role users scoped to the reserved `platform-operations` tenant (migration `0020_es21_platform_operator.sql`).
6. Tenant suspension (`TenantProvisioner.suspend()`) already exists but its enforcement middleware is not yet registered anywhere (that's PG-012, a hard dependency of this package's dunning→suspend flow).

**Completed Components:** Tenant provisioning, lifecycle state machine, feature-flag infrastructure, outbox/event pattern, scheduler job registry — all pre-existing and reusable, none built by this package.

**Pending Components:** Payment gateway selection (business decision, not started), exact pricing/plan definitions (business decision, not started), PG-012 (tenant suspension enforcement — hard dependency), PG-028 (usage-based billing tiers would consume this package's plan/invoice model, but is out of scope here — this package ships flat-rate-per-plan billing only, not usage-metered billing).

**Known Constraints:** Dev-phase, no real production data yet (safe to iterate on schema) — but this specific package should not go live commercially without the payment-gateway and pricing decisions being real, confirmed business decisions, not developer guesses.

**Coding Standards:** See the Coding Standards section above — Fastify+Zod+Drizzle, `requirePermission`, `@erp/logger`, OTel via `PlatformContext.trace()` if applicable, Prometheus via `getOrCreateCounter`. The only genuinely novel pattern this package introduces is the `PaymentGatewayAdapter` interface, justified because no prior art exists for external payment integration in this codebase.

**Reusable Components:** `TenantProvisioner.suspend/activate/close`, `PlatformFeatureFlags`, `JobRegistry.register/schedule/triggerManual`, `PlatformEventBus.publish`, `notification-service`'s SendGrid/template pipeline, `getOrCreateCounter` from `packages/logger/src/erp-metrics.ts`.

**APIs Already Available:** `POST/GET/PATCH /admin/tenants*` (tenant-service, `PLATFORM_TENANT_MANAGE`-gated) — this package adds sibling routes under the same tenant, not a new resource tree.

**Events Already Available:** None directly reusable for billing — this package introduces the first billing-related event types.

**Shared Utilities:** `@erp/logger`, `@erp/config` (`requireEnv`), `@erp/types` (`PERMISSIONS`, error classes `NotFoundError`/`ValidationError`/`BusinessError`), `@erp/sdk` (= `packages/platform-sdk` — note the package.json `name` field is `@erp/sdk` despite the directory being named `platform-sdk`, a naming mismatch worth knowing about before searching for the wrong directory).

**Feature Flags:** This package uses feature flags as its enforcement mechanism (see Architecture) rather than being gated behind one itself.

**Multi-Tenant Rules:** `tenant_invoices` is tenant-scoped (`tenant_id NOT NULL`, explicit `WHERE` everywhere). `plan_entitlements` is deliberately global (no `tenant_id`) — it is a tier template, not a tenant instance, analogous to `ROLE_DEFAULTS`.

**Security Rules:** All new admin routes require `PLATFORM_TENANT_MANAGE`. No raw payment-card data ever stored — only gateway-issued opaque tokens/references.

**Database State:** Depends on migrations through `0034_organization_theme_config.sql` (re-verify the actual latest number before authoring `0035`, since concurrent packages/sessions may add migrations first — see `[[concurrent_sessions_on_same_repo]]`).

**Testing Status:** No billing-related tests exist (nothing to test yet). `apps/tenant-service/src/__tests__/tenant-admin-authz.test.ts` and `tenant.integration.test.ts` are the closest existing test-style precedents to follow.

**Next Session Plan:** This package should be split across at least 3 sessions given its XL complexity: **Session 1** — schema + `plan_entitlements`/`tenant_invoices` tables + `BillingService` entitlement-copy logic + provisioning-step wiring (no payment gateway yet, no scheduler job yet). **Session 2** — `PaymentGatewayAdapter` interface + one concrete implementation (once the gateway is chosen) + the `tenant-billing-cycle` scheduler job + dunning/suspension wiring (depends on PG-012 being real, not just written). **Session 3** — admin routes, frontend Billing tab, notification templates, full test suite.

**Prompt for the Next Session:** "Resume `ERP-PLANNING/production-gap-prompts/004-Platform/29-subscription-billing-license-management.md` (PG-027). Before writing any code, re-verify: (1) has PG-012 (tenant suspension enforcement) actually landed — check whether `createTenantContextMiddleware` is registered in any service's `main.ts` yet; (2) has the payment gateway been chosen by the product owner — check this file's own 'Assumption to confirm' notes for whether that conversation happened; (3) re-grep `tenants.plan`/`tenants.settings` usage to confirm nothing else started touching these columns since this doc was written. Then proceed with [Session N] as scoped in this file's 'Next Session Plan'."
