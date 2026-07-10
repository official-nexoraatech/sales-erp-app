# [PG-058] Blue/Green or Canary Release Strategy

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Deployment
**Priority:** Low
**Complexity:** L — not for the release-strategy mechanics themselves (well-trodden K8s patterns), but for the schema-compatibility discipline a shared-database zero-downtime strategy forces onto every future migration, indefinitely.
**Depends on:** PG-057 (production deployment runbook & rollback strategy)
**Blocks:** none
**Primary service(s)/package(s):** `infrastructure/k8s/*.yaml`, `infrastructure/helm/` (once PG-022 lands), `.github/workflows/ci.yml`, `packages/db-client` (migration-authoring convention, not code)

---

## Overview

- **Business objective:** Once PG-057's runbook exists, a production deploy becomes a documented rolling replacement of pods — brief per-service unavailability during rollout, no explicit zero-downtime guarantee. For most SMB-tier ERP deployments (this system's actual target market — single-tenant-per-customer, business-hours-driven usage, no 24/7 global user base implied anywhere in this codebase's architecture) a short, scheduled maintenance window is an acceptable, industry-normal tradeoff, not a defect. This package exists to honestly evaluate whether true zero-downtime releases (blue/green or canary) are worth building *now* versus deferred indefinitely as a Phase 9 enterprise differentiator for a specific large/24-7 customer commitment — not to assume zero-downtime is self-evidently necessary.
- **Current implementation:** None. No blue/green or canary infrastructure exists anywhere in the repo (verified — `infrastructure/k8s/*.yaml` manifests are plain `Deployment` resources with `HorizontalPodAutoscaler`/`PodDisruptionBudget`, using Kubernetes' default `RollingUpdate` strategy implicitly; no `Service` mesh routing rules, no Istio `VirtualService`/`DestinationRule` traffic-splitting config, despite `infrastructure/istio/` existing as a directory — worth checking what's actually in it before assuming it's unused scaffolding versus a partial start). No feature-flag-based canary gating exists at the application layer either (the tenant feature-flag system referenced elsewhere in this backlog, e.g. `ES-28`'s seed-feature-flag-defaults migration, gates *product features* per tenant, not *release versions* per request).
- **Current architecture:** Single shared Postgres, no read replica in active use for writes (PG-005 addresses replica read-offload separately), no per-tenant schema or database (confirmed repo-wide convention: every table carries `tenant_id`, isolation is entirely application-code `WHERE tenant_id = ?` filtering — see the Master Roadmap's own "Enterprise Architecture Guidance"). This is the single fact that shapes everything else in this package: **whichever release strategy is chosen, both the old and new application version must run correctly against the exact same database schema during the overlap window**, because there is no mechanism to give the "green"/canary version its own database or schema copy without a much larger architectural change (per-tenant schema-per-version is not how this system is built and re-architecting it is far outside this package's scope).
- **Current limitations:** No traffic-splitting mechanism (Istio directory exists but its actual contents/wiring status need verification, not assumption). No documented backward-compatibility contract for migrations beyond the general "additive/reversible" rule already stated in the Master Roadmap's Enterprise Architecture Guidance — that general rule is necessary but not sufficient for blue/green specifically, where *two full application versions* (not just "the new version plus a rollback path") query the same schema simultaneously for the duration of a canary/blue-green cutover window, which can be minutes to hours, not the near-instantaneous window an ordinary rolling deploy implies.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `infrastructure/k8s/*.yaml`'s existing `HorizontalPodAutoscaler`/`PodDisruptionBudget`/`readinessProbe` definitions per service — a canary rollout builds on top of these (e.g., a canary `Deployment` variant with a small replica count behind the same `Service` selector, weighted via Istio `VirtualService` if adopted, or via two `Deployment`s with pod-label-based traffic splitting if not) rather than replacing them.
  - `infrastructure/istio/` — **must be inventoried before this package assumes a starting point.** If it contains real, wired `VirtualService`/`DestinationRule`/`Gateway` manifests already, canary traffic-splitting is a smaller lift than if it's an empty/scaffold directory (mirroring this repo's repeated pattern of a plausible-looking directory turning out to be a `.gitkeep`-only placeholder, per `infrastructure/helm/`'s own state as documented in PG-021).
  - PG-057's rollback procedure (application-only `kubectl rollout undo` as the default path) — blue/green's rollback is actually *simpler* than PG-057's general case in one respect (the old "blue" environment is still fully running and can be instantly re-pointed-to), but *harder* in the schema-compatibility respect described above, since it must hold for the entire overlap window, not just the moment of cutover.
- **What should never be modified:** The application-code multi-tenancy model (`tenant_id`-scoped queries, no RLS, no per-tenant schema) — this package works within that constraint, it does not propose changing it to enable per-version data isolation.
- **Prior related work:** None specific to release strategy exists yet in `phase-completions/`. PG-021's Deliverables note `infrastructure/helm/` is currently empty (`.gitkeep` only) — any blue/green/canary implementation depending on Helm-templated environment duplication should be sequenced after PG-022 (Kubernetes production readiness / Helm chart), reinforcing why this package is scoped to Phase 9, after both PG-021 and PG-022, not in parallel with them.

## Architecture

- **Binding constraint, stated first because it governs the strategy choice:** with one shared Postgres and no per-tenant/per-version schema isolation, *any* zero-downtime strategy requires every migration to be compatible with **both** the old and new application version simultaneously for the entire cutover window. This is a stricter, longer-lived version of the "additive/reversible" rule PG-057 already documents for ordinary rollback — under blue/green/canary it's not "reversible within a rollback decision window," it's "both versions must work correctly against this schema for as long as the canary/green environment runs in parallel," which could span a full business day for a cautious canary ramp-up. This constraint applies identically whether blue/green or canary is chosen — it is a property of the shared-database architecture, not of the release-strategy choice itself.
- **Blue/green vs. canary, evaluated for this system specifically:**
  - **Blue/green** (two full parallel environments, instant全-traffic cutover) is simpler to reason about for a system with 14 backend services and no live traffic-shaping infrastructure today — it needs only a second full set of Deployments + a way to flip a Service/Ingress selector or DNS/load-balancer target, not fine-grained per-request traffic splitting. Downside: doubles resource cost for the overlap window (14 services × 2), and an all-or-nothing cutover doesn't let a bad release affect only a small fraction of real traffic before being caught — it either fully works or fully doesn't, with a very quick blast radius.
  - **Canary** (gradually shifting a percentage of traffic to the new version) needs real traffic-splitting (Istio `VirtualService` weighted routing, or an ingress controller with canary annotations) — smaller blast radius on a bad release, but meaningfully more infrastructure to build and operate correctly (metrics-driven promotion/rollback, session affinity concerns for a stateful login/JWT flow, and the same database-compatibility constraint holding for potentially longer since a cautious canary ramp is slower than an instant blue/green cutover).
  - **Recommendation if/when this is ever built:** blue/green fits this system better than canary — this repo has no request-level traffic-shaping infrastructure today (Istio's actual wiring status is unverified, per Existing Code Analysis), 14 services is already a lot of surface to coordinate a fine-grained canary promotion policy across, and this system's actual usage pattern (business-hours ERP traffic, not consumer-scale continuous deployment) doesn't need canary's gradual-exposure benefit as much as a high-traffic consumer product would. Canary's finer blast-radius control is a real advantage but not one this system's risk profile currently justifies paying the extra operational complexity for.
- **Scope decision — explicitly Phase 9, not Phase 8:** per the Master Roadmap's own phase breakdown, this package (PG-058) sits in "Phase 9 — Enterprise Enhancements," not "Phase 8 — Production Readiness" (which is PG-057 alone). This is deliberate, not an oversight: most SMB-tier ERP customers — this system's actual target market, per its own architecture (single shared Postgres, no multi-region, no per-tenant infra) — tolerate a short, scheduled maintenance window for a release, and PG-057's rolling-deploy-plus-documented-rollback runbook is sufficient production-readiness for that market. Zero-downtime release infrastructure is worth building only when a specific enterprise customer commitment requires it (e.g., a contractual uptime SLA that a maintenance window would violate), not speculatively ahead of that need — building it now would be exactly the kind of "flexibility that wasn't requested" this project's own engineering guidelines caution against. **This package should not be started until a concrete customer/business driver names it as required.**

## Database Changes

- Not applicable as a schema change from this package itself — but this package's binding constraint (see Architecture) means every *future* migration, for as long as blue/green/canary releases are in use, must additionally satisfy "safe for both the currently-live old version and the incoming new version to query simultaneously for the full overlap window," which is a stricter, ongoing discipline this package would impose on `packages/db-client/migrations` going forward, not a one-time migration this package itself adds.

## Backend

Not applicable — no application code changes from this package itself (aside from imposing the stricter dual-version schema-compatibility discipline on all *future* migrations, which is a process constraint, not a code change).

## Frontend

Not applicable — backend/infra-only gap. If ever built, `web-frontend`/`pos-frontend` static builds would need the same dual-version-compatible API contract discipline (don't call a new-only endpoint until the old backend version is fully retired from the blue/green rotation), but no frontend code changes are part of this package's own scope.

## API Contract

Not applicable — no new endpoints; existing endpoints must simply remain backward-compatible across the overlap window if this strategy is ever adopted.

## Multi-Tenant Considerations

- The core multi-tenant fact governing this entire package: because tenant isolation here is application-code `tenant_id` filtering against one shared database (not per-tenant schema/instance), there is no way to migrate one tenant's traffic to the "green"/canary version while others stay on "blue" at the database level — a canary-by-tenant-cohort approach (a genuinely useful lower-risk pattern for a multi-tenant SaaS) is possible at the *application-routing* layer (e.g., route specific pilot tenants' requests to the canary Deployment) but does **not** reduce the shared-schema compatibility constraint at all, since all tenants' data lives in the same tables regardless of which app version serves which tenant's requests.

## Integration

- **`infrastructure/k8s/*.yaml`, `infrastructure/istio/`** — would need canary/blue-green-specific manifests (a second Deployment variant per service, plus traffic-splitting config if canary is chosen) — not part of this package's actual deliverable unless/until greenlit (see Architecture's scope decision).
- **`.github/workflows/ci.yml`** — the `deploy-staging`/production-deploy job (post-PG-021/057) would need a materially different flow (gradual traffic shift + automated promotion/rollback based on error-rate metrics) rather than the single-shot rolling deploy PG-057 documents.
- **`packages/db-client/migrations`** — the ongoing dual-version-compatibility discipline this package would impose, if adopted.

## Coding Standards

- No new code from this package as scoped (a decision/evaluation document, gated for future implementation). If and when actually built, it would extend the existing Kubernetes/Kustomize-or-Helm pattern PG-021/PG-022 establish — no new deployment tooling paradigm (e.g., no adopting a dedicated GitOps/canary-management product like Argo Rollouts/Flagger) should be introduced without that being its own explicitly-scoped follow-up decision, given "no new pattern without justification" is this backlog's own cross-cutting Enterprise Architecture Guidance.

## Performance

- Blue/green doubles peak resource consumption (2× replica count across 14 services) for the duration of every cutover window — a real infrastructure cost that should be weighed against the (currently unclaimed) business need for zero downtime before this package is ever actually built.

## Security

- Not applicable beyond what PG-057 already establishes (least-privilege deploy credentials) — no new attack surface from the release-strategy choice itself, though a canary approach's traffic-splitting layer (if Istio) would need its own mTLS/network-policy review, which is out of scope until the package is actually greenlit.

## Testing

- Not applicable as a testing deliverable from this package itself, since no implementation is being built now. If greenlit in the future, its own acceptance testing would need a deliberate "deploy a schema change incompatible with the old version" negative test to prove the dual-version-compatibility discipline is actually enforced (e.g., via a migration-linting CI check that flags non-additive changes while blue/green is in use) — noted here as a requirement for whoever picks this package up later, not built now.

## Acceptance Criteria

- [ ] `infrastructure/istio/`'s actual contents are inventoried and documented (wired and real, or scaffold-only like `infrastructure/helm/` was found to be) so a future session doesn't have to re-discover this.
- [ ] A documented recommendation exists (blue/green over canary, per the Architecture section's reasoning) so a future session doesn't re-litigate the choice from scratch.
- [ ] This package remains explicitly filed under Phase 9 (Enterprise Enhancements), not promoted to Phase 8, unless a concrete customer/business driver is named that requires it — that decision itself is the actual, checkable deliverable of this package as scoped today.
- [ ] No blue/green/canary infrastructure is built prematurely — confirmed by this package's own Deliverables being limited to documentation/evaluation, not `infrastructure/k8s` manifest changes.

## Deliverables

- **Files to create:** none beyond this gap-prompt file itself, until a concrete business driver greenlights implementation — at that point, the actual deliverables would be a second `Deployment` variant (or Argo Rollouts/Flagger-style canary resource) per service under `infrastructure/k8s/` or the Helm chart PG-022 introduces, plus a traffic-splitting config (Istio `VirtualService`/`DestinationRule` if that route is chosen) and a new CI deploy job — none of that is built as part of closing this package today.
- **Files to modify:** none.
- **Migrations:** none from this package; imposes an ongoing dual-version-compatibility discipline on all future migrations if/when adopted.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** none from this package as scoped; a future implementation would need a migration-compatibility lint check (see Testing).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** No blue/green or canary deployment infrastructure exists. PG-057 (this package's dependency) establishes an ordinary rolling-deploy-plus-documented-rollback runbook, which is judged sufficient for this system's actual target market (SMB-tier ERP, short-maintenance-window-tolerant). `infrastructure/istio/` exists as a directory but its actual wiring status (real config vs. empty scaffold, similar to how `infrastructure/helm/` turned out to be `.gitkeep`-only per PG-021's findings) has not been verified in this pass and must be checked by whoever picks this up.

**Current Objective:** This package's actual current deliverable is a *decision*, not an implementation: document that a shared, single-Postgres, no-per-tenant-schema architecture means any zero-downtime strategy requires strict dual-version schema compatibility for the full cutover window regardless of which strategy is picked; recommend blue/green over canary for this system's specific shape (14 services, no existing traffic-shaping infra, business-hours usage pattern); and confirm this stays a Phase 9 enterprise-enhancement item, not a Phase 8 production-readiness requirement, unless a specific customer commitment says otherwise.

**Architecture Snapshot:**
1. Single shared Postgres, `tenant_id`-scoped application-code isolation, no RLS, no per-tenant schema — this is the fact that makes dual-version schema compatibility the binding constraint for any zero-downtime strategy here.
2. `infrastructure/istio/` exists but its real content/wiring is unverified — check it first, don't assume either way.
3. `infrastructure/helm/` is confirmed empty (`.gitkeep` only, per PG-021) — any Helm-based environment-duplication approach depends on PG-022 landing first.
4. PG-057 (this package's dependency) is the actual Phase 8 production-readiness deliverable; this package is explicitly deferred past it into Phase 9.

**Completed Components:** Not applicable — nothing has been built for this package yet; it is a decision/scoping document at this stage.

**Pending Components:** All actual implementation (second-environment manifests, traffic-splitting, canary-promotion CI logic) — explicitly not part of closing this package unless a business driver greenlights moving it out of Phase 9.

**Known Constraints:** No live cluster needed to complete this package's actual current scope (a decision document); if a future session is asked to *implement* blue/green, it should re-confirm PG-021/PG-022's actual landed state first, since this package assumes both are done.

**Coding Standards:** No new deployment-tooling paradigm without explicit justification, per the Master Roadmap's Enterprise Architecture Guidance; if ever implemented, extend the existing Kubernetes/Kustomize-or-Helm pattern rather than adopting a new product (Argo Rollouts/Flagger) without that being its own explicitly justified sub-decision.

**Reusable Components:** PG-057's rollback runbook and PG-021's rollout-status/smoke-gate mechanics — a blue/green implementation would reuse both rather than inventing parallel ones.

**APIs Already Available:** `GET /health` per service — same smoke-gate mechanism a blue/green cutover's readiness check would use.

**Events Already Available:** Not applicable.

**Shared Utilities:** Not applicable.

**Feature Flags:** the existing tenant feature-flag system gates *product features* per tenant, not *release versions* per request — do not conflate the two if a future session considers tenant-cohort canarying.

**Multi-Tenant Rules:** tenant isolation is shared-database/application-code only — no mechanism exists to give a canary/green version its own data copy; any tenant-cohort canary approach would only shift *routing*, never *data isolation*.

**Security Rules:** no new rules beyond PG-057's least-privilege deploy-credential standard.

**Database State:** depends on whatever migrations exist at the time this is picked up; the key requirement is that all migrations from that point forward satisfy the dual-version-compatibility discipline described in Architecture, for as long as this strategy is in use.

**Testing Status:** none — this package has not been implemented, only evaluated/scoped.

**Next Session Plan:** Single session sufficient for the current scope (writing/confirming this decision document, inventorying `infrastructure/istio/`). Do not expand into actual implementation in the same session without an explicit go-ahead tied to a named business driver — that would be a much larger, separately-scoped follow-up package.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/016-Deployment/56-blue-green-canary-release-strategy.md` and confirm PG-058's scope is still correctly deferred to Phase 9 — check whether a concrete customer/business driver now requires zero-downtime releases; if not, no implementation work is needed, only re-confirm `infrastructure/istio/`'s actual contents and PG-057/PG-022's landed state so this file's assumptions stay accurate for whenever it is eventually picked up."
