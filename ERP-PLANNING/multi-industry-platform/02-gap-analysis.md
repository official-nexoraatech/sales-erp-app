# 02 — Gap Analysis: Current Nexoraa → Target Multi-Industry Platform

Each gap cites evidence from `01-current-state.md`. Priority: P0 = architectural blocker (must land before a 3rd vertical), P1 = important for the next stage, P2 = future scalability, P3 = optional/long-term.

---

### G1 — No runtime module/capability gating (P0)

**Problem:** `tenants.vertical` is read only at provisioning time (§3). Nothing checks "is this module enabled for this tenant" at request time. A role that happens to grant `HR_VIEW` will see HR even on a tenant where HR was never provisioned for that business type.
**Evidence:** `01-current-state.md` §3, §7. Zero `enabledModules`/`ModuleRegistry`/`CapabilityRegistry` concept anywhere in the repo.
**Impact:** Every new industry either gets bespoke conditionals scattered through routes/nav (exactly what the brief prohibits, §7) or leaks modules it shouldn't have. Blocks clean onboarding of a 3rd vertical.
**Recommended solution:** Build a Module/Capability Registry on top of the _existing_ `feature_flags` primitive (already proven, already hot-reloadable) — see `05-module-capability-model.md`. Do not build a second flags system.
**Alternatives considered:** New dedicated `tenant_modules` table with its own cache layer — rejected; would duplicate `PlatformFeatureFlags`'s cache/invalidation machinery for no benefit.
**Migration risk:** Low if additive (new flag keys, new registry metadata) — no existing behavior changes until routes/nav start consulting it.
**Dependencies:** None blocking; can start immediately.

### G2 — `tenants.vertical` is a hardcoded 2-value TS union, not an extensible model (P0)

**Problem:** `'CLOTH_RETAIL' | 'GROCERY'` union type (§3) — adding Hotel or Manufacturing means widening a TS union and touching 4 known call sites, but there's no Industry/BusinessType _hierarchy_, so "Hotel + India" vs. "Hotel + UAE" (brief §18) has nowhere to live.
**Evidence:** `packages/db-client/src/schema/tenant.ts:36-39`.
**Impact:** Blocks introducing a first genuinely new industry cleanly; blocks country/regulatory separation from industry.
**Recommended solution:** Introduce `business_types` + `industries` reference tables (see `03-target-architecture.md`, `04-domain-model.md`), keep `tenants.vertical` as a **backward-compatible alias column** during migration (see `15-migration-strategy.md`) rather than dropping it immediately.
**Alternatives considered:** Rename `vertical` → `businessType` in place — rejected as a breaking, big-bang change; additive new columns are safer per the brief's incremental-migration mandate.
**Migration risk:** Medium — touches `TenantProvisioner`, `default-accounts.ts`, `vertical-defaults.ts`, tests. All 4 call sites are known and small.
**Dependencies:** None.

### G3 — sales-service is a God service hosting both O2C and all of CRM (P0/P1 boundary)

**Problem:** 153 files, ~26k lines, one deployable/DB-pool/auth-chain for Order-to-Cash _and_ the entire CRM roadmap (`01-current-state.md` §9).
**Evidence:** `reportsengine_dedup_and_crm_split_2026_08_16` memory; `apps/crm-service` scaffolded but zero domain routes registered.
**Impact:** Every new industry that touches sales (all of them) inherits this service's blast radius, deploy coupling, and test-suite size. Adding a 3rd vertical without finishing this split compounds the problem.
**Recommended solution:** Finish the already-planned CRM/O2C split (plan already exists — see the memory) **before or in parallel with** Phase 10 (first new industry), not after. Do not let multi-industry work pile more domain code onto sales-service.
**Alternatives considered:** Defer the split further and just add industry code to sales-service too — rejected; would make the eventual split strictly harder and violates the brief's domain-ownership principle (§12).
**Migration risk:** High (financial/CRM-transactional stakes, already flagged in the memory as "several more focused sessions"). This is the single largest piece of _already-scoped, not-yet-executed_ work this plan depends on.
**Dependencies:** Blocks clean Phase 10 (first new industry) if that industry needs CRM-adjacent capability (most will, e.g. loyalty/referrals for Restaurant).

### G4 — RBAC has no formal module association (P1)

**Problem:** Permission-to-module mapping is implicit (string prefix convention only). No way to programmatically ask "which permissions belong to module X" to drive the capability-aware nav or a tenant's effective permission surface.
**Evidence:** `01-current-state.md` §4.
**Impact:** Module/capability-aware navigation and RBAC-capability integration (brief §6) can't be built cleanly without this.
**Recommended solution:** A `MODULE_PERMISSIONS` metadata map (module key → `Permission[]`), derived from the existing prefix convention where possible, hand-maintained where prefixes don't cleanly map (e.g. `POS_*` vs `pos` module). Additive, no permission renaming. See `07-rbac-model.md`.
**Alternatives considered:** Rename every permission to `MODULE.RESOURCE_ACTION` — rejected per explicit brief instruction not to redesign naming for aesthetics.
**Migration risk:** Low — pure metadata addition.
**Dependencies:** G1 (module registry needs to exist first).

### G5 — Navigation has no capability-awareness (P1)

**Problem:** `NAV_GROUPS` filters only on permission, never on "is this module enabled for this tenant" (§5). A tenant without HR enabled but with a role that grants `HR_VIEW` sees the HR nav group.
**Evidence:** `01-current-state.md` §5, `apps/web-frontend/src/lib/navigation.ts`.
**Impact:** Confusing/incorrect UX per-vertical; blocks the brief's target nav chain (Business Context + Enabled Modules + Permissions + Feature Flags → Nav).
**Recommended solution:** Extend `filterNavItem` to also check module-enablement (via the tenant's resolved capability set, fetched once per session alongside permissions) before the existing permission check — additive filter, same static `NAV_GROUPS` structure. See `08-navigation-model.md`.
**Alternatives considered:** Backend navigation service — explicitly rejected by the brief and unjustified by evidence (navigation is a small, static, frontend-owned concern today).
**Migration risk:** Low.
**Dependencies:** G1.

### G6 — Entitlement, permission, and feature flag are conceptually distinct but only two of the three primitives exist, and PG-027 is mid-build (P1)

**Problem:** `plan_entitlements`/`BillingService` (entitlement) and `feature_flags` (feature flag) both exist; RBAC (permission) exists. But entitlement enforcement today only covers numeric seat/branch caps (`assertUnderUserLimit`/`assertUnderBranchLimit`) — module-level entitlement ("does this tenant's _plan_ even include HR?") isn't wired to G1's module registry.
**Evidence:** `01-current-state.md` §21 discrepancy row; `packages/platform-sdk/src/entitlements.ts`; `BillingService.ts`.
**Impact:** Without this link, a tenant on a plan that excludes a module could still have it manually flag-enabled with no commercial gate, or vice versa a module could be entitlement-blocked without a clean way to say so in the nav/UX.
**Recommended solution:** Treat `plan_entitlements.feature_flags` as _already_ the entitlement→flag bridge (it already copies plan flags onto the tenant at `assignPlanEntitlements` time) — module registry (G1) should key off the same flag keys, so entitlement, module-enablement, and feature-flag-driven behavior stay one mechanism with three semantic layers on top. See `06-entitlement-model.md`.
**Alternatives considered:** Build a parallel `tenant_module_entitlements` table — rejected, duplicates what `plan_entitlements.feature_flags` already does.
**Migration risk:** Low — this is a design/documentation gap more than a code gap; PG-027 Sessions 2–3 (payment gateway, billing job) remain out of scope for this initiative.
**Dependencies:** G1.

### G7 — RLS designed but not enabled; tenant isolation is app-layer-only (P1, security)

**Problem:** No DB-level backstop against a tenant-scoping bug in application code (§8). `TenantScopedDatabase.raw` (majority of routes) never sets the RLS session GUC.
**Evidence:** `ES-36_COMPLETION.md`; zero `CREATE POLICY` across 169 migrations.
**Impact:** As tenant count and new-industry service surface grow, the number of code paths that must each correctly filter by `tenant_id` grows too — no defense-in-depth today.
**Recommended solution:** Do not enable RLS blindly. First close the GUC-per-request gap (set `app.current_tenant_id` on every connection checkout via a pool-level hook, not only inside explicit transactions), then enable RLS incrementally table-by-table with a monitored rollout, per `ES-36`'s own stated next step. This is a security-hardening initiative, evidence-based, not committed by this plan. See `13-security-architecture.md`.
**Alternatives considered:** Enable RLS now — rejected, would break the dominant non-transactional read path per `ES-36`'s own finding.
**Migration risk:** High if rushed; medium if sequenced as `ES-36` itself recommends.
**Dependencies:** None blocking multi-industry work directly, but should not be delayed indefinitely as tenant/service count grows.

### G8 — Batch/expiry tracking and UOM conversion — SUBSTANTIALLY SHIPPED since this gap was first written (verified 2026-08-18)

**Original problem (as of the 08-16 audit):** GRN captured `batchNumber`/`expiryDate` but dropped them before `inventoryLedger` — no FEFO, no expiry alerting. Every item had exactly one `unitId` — no case↔piece/kg↔g conversion.
**Correction, verified directly against code on 2026-08-18:** This has been built. Migrations `0165_inventory_batch_expiry_fefo.sql` and `0166_purchase_unit_conversion.sql` (both dated "Multi-vertical platform audit 2026-08-16") add `items.fefoEnabled`, `inventory_fifo_layers.batchNumber`/`.expiryDate` (+ a FEFO-order index), and `items.purchaseUnitId`/`.purchaseUnitConversionFactor` + `grnLines.receivedQtyBaseUnit`. Confirmed **real consuming code**, not just schema: `apps/purchase-service/src/domain/GRNService.ts` (writes batch/expiry on receipt), `apps/inventory-service/src/jobs/nearExpiryAlert.job.ts` (+ its integration test) for expiry alerting. Two adjacent gaps mentioned alongside G8 in prior planning (`19-first-industry-recommendation.md`) are also shipped: multi-buy/BOGO pricing (`apps/sales-service/src/domain/PromotionService.ts`/`PromotionEngine.ts`, migration `0167_pricing_promotions.sql`) and POS Z-report/day-end settlement (`apps/sales-service/src/domain/DayEndSettlementService.ts`, migration `0168_pos_day_end_settlements.sql`).
**Not independently re-verified in this pass:** whether stock _issuance_ (consumption order for a `fefoEnabled` item) actually prefers earliest-expiry layers over earliest-received layers at the point of sale/transfer — batch/expiry _capture_ and _alerting_ are confirmed real; FEFO-order _consumption_ logic specifically was not traced end-to-end in this correction pass. Flag for verification before citing "FEFO issuance" as fully proven, though the dedicated index (`idx_fifo_layers_fefo_order`) strongly suggests it was built for exactly that purpose.
**Revised status:** P1 → effectively closed as a blocker. Downgrade from "must land before Phase 10" to "verify FEFO consumption-order end-to-end as a small follow-up check," not a phase-gating dependency. `16-phase-roadmap.md` Phase 7 and `19-first-industry-recommendation.md` should be read with this correction in mind — see the note added to each.

### G9 — No formal event-governance document, though the mechanism is sound (P2)

**Problem:** Envelope fields (tenantId/correlationId/causationId/schemaVersion) already exist on every event, but there's no written naming/ownership/versioning policy a new industry service can be handed.
**Evidence:** `01-current-state.md` §10.
**Impact:** Low near-term risk (mechanism already enforces the hard parts structurally), but as more services join, undocumented convention drifts.
**Recommended solution:** Write down the existing convention as policy (topic derivation rule, `EventTypes` registration process, schema-registry usage expectations) — documentation work, not new code. See `10-event-architecture.md`.
**Migration risk:** None (docs only).
**Dependencies:** None.

### G10 — No commercial entitlement enforcement beyond seats/branches; billing has no payment gateway (P2/P3)

**Problem:** `BillingService` copies plan template but there's no recurring billing-cycle job, no `PaymentGatewayAdapter`, no admin billing UI, and `createTenantContextMiddleware` (suspension enforcement) is not registered anywhere.
**Evidence:** `01-current-state.md` §21; `ERP-PLANNING/production-gap-prompts/004-Platform/29-subscription-billing-license-management.md` Sessions 2–3.
**Impact:** No way to commercially gate a tenant's module access today beyond manual admin action. Not blocking for the architecture work in this plan, but relevant context for `06-entitlement-model.md` and Phase 11.
**Recommended solution:** Out of scope for this initiative per the brief's explicit instruction not to implement billing. Flagged for a separate, already-partially-scoped initiative (PG-027 Sessions 2–3).
**Migration risk:** N/A — not in scope.
**Dependencies:** PG-012 (tenant suspension enforcement) must land first regardless of when billing resumes.

### G11 — Reporting is direct-DB against a replica, not projection-fed (P2)

**Problem:** `report-service` queries Postgres directly (likely via replica) rather than building its own projections from Kafka events, despite `event-service` already having a working Projections component for other purposes.
**Evidence:** `01-current-state.md` §12.
**Impact:** Couples report-service's query shape to every operational service's live schema; a new industry's reporting needs either extend this coupling or need a real projection strategy.
**Recommended solution:** Not urgent to change existing reports (they work, and the replica already isolates load from primary). For **new industry-specific analytical needs** (e.g. hotel occupancy trends, manufacturing OEE), prefer event-fed projections over adding more direct cross-schema queries to `ReportEngine.ts`, to avoid growing the coupling further. See `11-reporting-architecture.md`.
**Migration risk:** Low (recommendation for new work, not a retrofit).
**Dependencies:** None.

### G12 — Country/regulatory logic (GST) is well-isolated already, but not yet abstracted behind a generic "compliance pack" concept (P2)

**Problem:** `gst-service` is cleanly decoupled at the _service_ boundary (event consumers + internal HTTP, no shared TS imports — brief §18's goal is already substantially met), but there's no explicit `Industry × Country` model anywhere for a future "Hotel + UAE" scenario.
**Evidence:** `01-current-state.md` §6 (gst discovery agent) — no cross-imports found between gst-service and accounting-service.
**Impact:** Not urgent — no international deployment is currently planned. But the target `Business Profile` model (G2's fix) should not conflate industry and country, so this doesn't need re-untangling later.
**Recommended solution:** Model `Industry` and `Country/RegulatoryPack` as separate dimensions in the target Business Profile model from the start (see `03-target-architecture.md`), even though only India is populated today.
**Migration risk:** None — additive modeling choice only.
**Dependencies:** G2.

### G13 — AI Copilot is already correctly tenant/permission-scoped by construction (not a gap — confirmed strength)

**Evidence:** `apps/ai-copilot-service/src/domain/ToolRegistry.ts` — every tool call proxies through the gateway using the requesting user's own JWT; no direct DB/SQL access. Listed here to confirm the brief's §20 concern is already satisfied, not to flag new work.

---

## Summary table

| ID  | Gap                                              | Priority      | Blocks                                   |
| --- | ------------------------------------------------ | ------------- | ---------------------------------------- |
| G1  | No runtime module/capability gating              | P0            | Everything downstream of it              |
| G2  | `vertical` is a hardcoded 2-value union          | P0            | Onboarding any 3rd industry              |
| G3  | sales-service God service / CRM split unfinished | P0            | Clean Phase 10                           |
| G4  | RBAC has no module association                   | P1            | G1, G5                                   |
| G5  | Navigation has no capability-awareness           | P1            | Clean UX per industry                    |
| G6  | Entitlement↔module link undefined                | P1            | Clean commercial story                   |
| G7  | RLS designed, not enabled                        | P1 (security) | Defense-in-depth at scale                |
| G8  | Batch/expiry + UOM missing                       | P1            | Grocery maturity + most future verticals |
| G9  | Event governance undocumented                    | P2            | New-service onboarding hygiene           |
| G10 | Billing/payment gateway incomplete               | P2/P3         | Commercialization only                   |
| G11 | Reporting is direct-DB, not projection-fed       | P2            | New analytical scale only                |
| G12 | No Industry×Country separation yet               | P2            | Future international deployment          |
