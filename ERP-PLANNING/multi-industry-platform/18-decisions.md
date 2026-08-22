# 18 — Architecture Decision Records

## ADR-01: Business Profile as a new Industry/Business Type model, `vertical` retained as a synced legacy column

**Status:** Proposed
**Context:** `tenants.vertical` (`packages/db-client/migrations/0164_tenants_vertical.sql`) is a hardcoded 2-value TS union read at provisioning time only by 4 call sites (`01-current-state.md` §3). The brief requires an extensible Industry → Business Type model without a big-bang rewrite.
**Decision:** Add `industries`/`business_types` reference tables and `tenants.business_type_id`. Keep `vertical` as a column, synced by a write-path helper, so existing call sites never need to change during the transition.
**Alternatives considered:** (a) Rename `vertical` in place — rejected, breaking change, violates incremental-migration mandate. (b) Drop `vertical` immediately after backfill — rejected, no verified deprecation window yet, premature per CLAUDE.md's surgical-changes principle.
**Consequences:** One extra sync point to maintain (mitigated — `17-risk-register.md` R2) until a future decision retires `vertical` outright.
**Migration impact:** Additive only; see `15-migration-strategy.md` steps 1–2.

## ADR-02: No Organization/Company-group layer

**Status:** Confirmed (matches brief's default assumption, verified against code)
**Context:** Brief explicitly asks not to introduce this unless evidence proves it's needed.
**Decision:** Tenant remains the root of the hierarchy. `organization_settings` is tenant-scoped config, not a parent entity, confirming no such need exists today.
**Alternatives considered:** None seriously — no evidence surfaced during discovery suggesting multi-tenant grouping is needed.
**Consequences:** None — status quo preserved.
**Migration impact:** None.

## ADR-03: Module/Capability enablement is modeled entirely on the existing `feature_flags` mechanism, not a new table

**Status:** Proposed
**Context:** `02-gap-analysis.md` G1/G6. `PlatformFeatureFlags` already provides tenant-override, 2-tier caching, and hot pub/sub invalidation.
**Decision:** `MODULE_REGISTRY` (code) maps module → required flag keys. Module enablement = all required flags true. No new `tenant_modules` table.
**Alternatives considered:** New dedicated entitlement/module table with its own cache — rejected as pure duplication (CLAUDE.md §2, Simplicity First).
**Consequences:** Module state and feature-flag state share one storage/cache/invalidation path — one less system to keep consistent, at the cost of the two concepts not being separately queryable in the DB (mitigated: `MODULE_REGISTRY` is the query layer, in code).
**Migration impact:** None to existing flags; additive registry only.

## ADR-04: RESOURCE_ACTION permission naming is preserved unchanged; module association is metadata, not a rename

**Status:** Confirmed
**Context:** Brief explicitly prohibits renaming for aesthetic reasons; `01-current-state.md` §4 confirms the existing prefix convention already substantially encodes module membership.
**Decision:** New `MODULE_PERMISSION_PREFIXES` map derives module membership by prefix match. No permission constant is renamed or restructured.
**Alternatives considered:** Rename to `MODULE.RESOURCE_ACTION` dotted form — rejected per explicit brief instruction.
**Consequences:** A handful of cross-cutting permissions (e.g. `BRANCH_SCOPE_BYPASS`) remain unclaimed by any module — correct, since they're platform-level, not module-level.
**Migration impact:** None — purely additive metadata file.

## ADR-05: No backend navigation service; capability-awareness added to the existing static, frontend-owned `navigation.ts`

**Status:** Confirmed
**Context:** Brief §7 explicitly prohibits this without justification; `01-current-state.md` §5 confirms `navigation.ts` is small (1024 lines), static, and has no existing backend counterpart.
**Decision:** Extend `filterNavItem` with a module-enabled predicate, sourced from an extension of the existing permissions payload (`enabledModules[]`), not a new endpoint/service.
**Alternatives considered:** Backend navigation microservice — rejected, no evidence of complexity that would justify it.
**Consequences:** Navigation logic remains a frontend concern, consistent with the brief's target chain.
**Migration impact:** Additive field on `NavItem`/`NavGroup`; existing items unaffected unless explicitly tagged.

## ADR-06: JWT strategy and gateway trust boundary are unchanged; no new trusted headers

**Status:** Confirmed
**Context:** `apps/api-gateway/src/middleware/gateway-auth.ts` already documents and enforces this boundary; brief §8/§36 makes it a hard constraint.
**Decision:** All new context (module enablement) is either re-derived per-service from tenant-scoped state or carried inside the JWT — never a forwarded header.
**Alternatives considered:** `X-Business-Type`/`X-Enabled-Modules` headers for gateway-level pre-filtering — rejected, reintroduces the exact spoofing risk the existing architecture deliberately avoids.
**Consequences:** Slightly more per-service computation (each service re-derives module state) vs. a single gateway-computed header — an intentional, correct tradeoff for security.
**Migration impact:** None.

## ADR-07: Tenant isolation stays application-level (`tenant_id` + filter); RLS is a separate, sequenced hardening track, not a prerequisite

**Status:** Proposed (sequencing only — RLS itself remains a future decision)
**Context:** `ES-36_COMPLETION.md` found RLS would break the dominant non-transactional read path today. `02-gap-analysis.md` G7.
**Decision:** Fix the GUC-per-request gap first (connection-level, not transaction-only), then consider RLS table-by-table as an independent initiative. Not required before or during multi-industry work.
**Alternatives considered:** Enable RLS now — rejected, would cause platform-wide read failures per `ES-36`'s own finding.
**Consequences:** Isolation remains single-layer (app code correctness) through this initiative's timeline — acceptable given no new isolation-relevant code pattern is introduced by the Business Profile/Module model (all new checks read tenant-scoped state through already-tenant-scoped mechanisms).
**Migration impact:** None from this initiative; RLS rollout itself would be migration-heavy but is out of scope here.

## ADR-08: Domain ownership — new industry aggregates get one authoritative owning service from day one; report-service/search-service/AI-copilot remain read-only consumers

**Status:** Confirmed (continuity of existing pattern)
**Context:** Brief §12; `01-current-state.md` §9–13 confirm this pattern already holds (Invoice→sales-service, Stock→inventory-service, etc.) with no found violations.
**Decision:** Any new industry aggregate (Reservation, Production Order, etc.) follows the same rule — decided explicitly at that industry's Phase-10 service-design time.
**Consequences:** None new — this is continuity, not change.
**Migration impact:** None from this document; applies to future Phase 10 design.

## ADR-09: Event/CRM/O2C service-split conventions are documented, not re-architected

**Status:** Confirmed
**Context:** `01-current-state.md` §10–11 confirms the outbox/schema-registry/saga/DLQ mechanism is already sound and already carries all governance-relevant envelope fields.
**Decision:** Phase 7's event-governance work is a documentation deliverable (write down existing convention), not new infrastructure. The CRM/O2C split executes an already-fully-scoped prior plan, not a new design.
**Consequences:** None — lowest-risk phase in the roadmap by design.
**Migration impact:** None (docs) / already-scoped (split).

## Index

| ADR    | Title                                                  | Status                |
| ------ | ------------------------------------------------------ | --------------------- |
| ADR-01 | Business Profile model, `vertical` retained            | Proposed              |
| ADR-02 | No Organization layer                                  | Confirmed             |
| ADR-03 | Module/Capability on existing feature-flags            | Proposed              |
| ADR-04 | RBAC naming preserved, module metadata only            | Confirmed             |
| ADR-05 | No backend navigation service                          | Confirmed             |
| ADR-06 | JWT/gateway trust boundary unchanged                   | Confirmed             |
| ADR-07 | RLS sequenced, not a prerequisite                      | Proposed (sequencing) |
| ADR-08 | Domain ownership continuity                            | Confirmed             |
| ADR-09 | Event governance is documentation, not re-architecture | Confirmed             |
