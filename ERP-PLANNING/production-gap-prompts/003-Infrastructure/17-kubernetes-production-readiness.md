# [PG-022] Kubernetes Production Readiness

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Infrastructure
**Priority:** Medium
**Complexity:** XL — spans 14 services' packaging, a net-new Helm chart, ingress/TLS strategy, and reconciling several manifest/app-code inconsistencies found during verification (see Current Limitations); genuinely too large for one session.
**Depends on:** none directly (this package is upstream of PG-021's long-term target and of PG-001's ingress hosting plan, but can start immediately against the manifests that already exist)
**Blocks:** none formally, but PG-021 should re-point at this package's Helm chart once it exists instead of the raw manifests it uses in the interim.
**Primary service(s)/package(s):** `infrastructure/k8s/`, `infrastructure/helm/`, `infrastructure/istio/`, `infrastructure/docker/`, all 14 backend services

---

## Overview

- **Business objective:** Running 14 stateful-adjacent Node services reliably in production requires more than "it starts" — it requires resource governance (so one leaky service can't starve the node), autoscaling, zero-downtime rollouts, network segmentation, and a real ingress/TLS front door. Without this, production Kubernetes operation is either manual and fragile or simply doesn't happen.
- **Current implementation — IMPORTANT CORRECTION to this package's originating brief:** The brief this package was scoped from assumed "no k8s manifests/helm charts currently exist in the repo." That is **false** — verified directly during this session. `infrastructure/k8s/` already contains 19 real files:
  - One manifest per backend service (14 total, matching the CI build matrix exactly): `auth-service.yaml`, `sales-service.yaml`, `inventory-service.yaml`, `accounting-service.yaml`, `purchase-service.yaml`, `hr-service.yaml`, `gst-service.yaml`, `notification-service.yaml`, `scheduler-service.yaml`, `search-service.yaml`, `tenant-service.yaml`, `event-service.yaml`, `production-service.yaml`, `report-service.yaml`. Each one already defines a `Deployment` (2 replicas, non-root `securityContext`, `runAsUser: 1001`, `readOnlyRootFilesystem: true`, dropped capabilities), a `Service`, an `HorizontalPodAutoscaler` (CPU 70% / memory 80% targets, min 2 / max 10 replicas), a `PodDisruptionBudget` (`minAvailable: 1`), and a `ServiceAccount`.
  - `namespace.yaml` — defines `erp-system` (with `istio-injection: enabled`) and `erp-infra`.
  - `network-policy.yaml` — a default-deny-all `NetworkPolicy` for `erp-system`, a DNS-allow policy, and one ingress/egress pair for `auth-service` (explicitly commented as a template: `# TODO: re-add a from-podSelector entry for api-gateway once it's implemented, see ES-28`). **Only `auth-service` has explicit network policies today — the other 13 services have no equivalent ingress/egress rules, meaning the default-deny-all policy would block them once enforced.** This is the real, verified gap in network policy, not "no network policy exists."
  - `cert-manager.yaml` — two Let's Encrypt `ClusterIssuer`s (prod + staging, both `http01` via `ingress: { class: nginx }`) and an internal self-signed CA + `Issuer` for service-to-service certs.
  - `vault-config.yaml` — a `ServiceAccount`/`ClusterRoleBinding` for Vault's Kubernetes auth delegation, plus a reference `ConfigMap` documenting the `vault auth enable kubernetes` / policy-write bootstrap commands.
  - `backup-cronjob.yaml` — a real `CronJob` (daily 02:00) running the same `pg_dump`/Redis `SAVE`/MinIO-mirror script as the docker-compose `backup` service (see PG-024).
  - Each service's Deployment already sets `LOKI_URL: http://loki.erp-infra.svc.cluster.local:3100` and `OTEL_EXPORTER_OTLP_ENDPOINT` env vars, and Vault-agent-injection annotations (`vault.hashicorp.com/agent-inject: "true"`, per-service `agent-inject-template` blocks that write `DATABASE_URL`/`JWT_*` to a file inside the pod).
  - `infrastructure/istio/` has `peer-authentication.yaml` (cluster-wide STRICT mTLS) and `authorization-policy.yaml` — real Istio policy resources, implying a service-mesh deployment model was intended.
  - `infrastructure/helm/` and `infrastructure/terraform/` are **genuinely empty** — each contains only a `.gitkeep`. This part of the original brief is accurate: there is no Helm chart and no infrastructure-as-code for actually provisioning the cluster itself.
- **Current architecture:** The manifests describe a namespace-per-concern model (`erp-system` for app workloads, `erp-infra` for Postgres/Redis/Kafka/MinIO/Loki/Jaeger/Vault), Istio-mesh mTLS between them, Vault-agent sidecar injection for secrets, and cert-manager for TLS. This is a coherent, reasonably sophisticated target architecture — the gap is that most of the pieces it assumes (Loki, Istio control plane, Vault server, an actual Ingress) are either not deployed anywhere or not wired all the way through.
- **Current limitations (verified, concrete):**
  1. **No Helm chart** — 14 near-identical manifests (same Deployment/Service/HPA/PDB shape, differing only in name/port/image) are hand-copy-pasted. Any cross-cutting change (e.g. bumping `readOnlyRootFilesystem` policy, or the Loki URL) requires editing 14 files by hand.
  2. **No Ingress resource anywhere** in `infrastructure/k8s/` (verified — `Glob` for `*ingress*` returned nothing), despite `cert-manager.yaml` assuming an `nginx` ingress class exists and despite the CI `deploy-staging` job pointing its `environment.url` at `https://erp-staging.nexoraatech.com`. There is no resource that would actually route that hostname to any service.
  3. **Network policy only covers `auth-service`** (see above) — the other 13 services have a default-deny-all policy with no matching allow rules, which would break them the moment the policy is actually enforced by a CNI that honors `NetworkPolicy` (Calico/Cilium) — today it is silently inert only if the cluster's CNI doesn't enforce `NetworkPolicy` at all, which is itself a fragile, accidental safety net.
  4. **Vault-agent injection is wired in the manifests but the application containers never consume it.** Every Deployment sets `vault.hashicorp.com/agent-inject-template-db` to write a file containing `export DATABASE_URL="..."` — but each service's Dockerfile `CMD` is a bare `node apps/<service>/dist/main.js` (verified against `apps/auth-service/Dockerfile`), which never sources that file. Combined with `DATABASE_URL` also being set as a plain env var elsewhere (see `packages/db-client` and `.env.example`), the Vault sidecar annotations are currently decorative — this matches (and extends, at the k8s-manifest level) the FEATURE_INVENTORY finding that "Vault is provisioned but never integrated" (see PG-004, which owns fixing the app-code side; this package should not silently duplicate that fix, only note the manifest-level half of the same gap).
  5. **No Loki deployment exists anywhere** (no `infrastructure/k8s/loki.yaml`, no docker-compose `loki` service) despite every service's manifest hard-coding `LOKI_URL: http://loki.erp-infra.svc.cluster.local:3100`. See PG-025, which owns actually deploying Loki — this package should not duplicate that scope, only flag that the manifests currently point at a service that doesn't exist.
  6. **No Terraform / IaC for the cluster itself** — node pools, VPC, IAM, managed-Postgres-vs-in-cluster-Postgres decisions are all undocumented.
  7. **Istio policies exist but no Istio control-plane installation manifest** (`istiod`, `IstioOperator`, gateway) is present — the `PeerAuthentication`/`AuthorizationPolicy` resources would be no-ops without Istio itself installed via `istioctl`/Helm, which isn't documented anywhere in this repo.

## Existing Code Analysis

- **What already exists and should be reused:** All 14 per-service manifests as the base to template into Helm — do not redesign their shape (Deployment/Service/HPA/PDB/ServiceAccount), only parameterize the fields that differ per service (name, port, image, resource sizing, Vault paths). `namespace.yaml`, `cert-manager.yaml`, `vault-config.yaml`, `backup-cronjob.yaml` as-is. The `network-policy.yaml` `auth-service` pair as the **template** to replicate (not redesign) for the other 13 services.
- **What should never be modified:** The already-correct `securityContext` hardening (`runAsNonRoot`, `readOnlyRootFilesystem`, dropped capabilities) present in every existing manifest — this is good, already-production-grade practice; do not loosen it while templating into Helm.
- **Prior related work:** `ERP-PLANNING/phase-completions/dr-drill-report.md` (restore drill proving all 14 services boot and pass health checks from a cold restore — useful as a reference for readiness-probe timing/expectations). `ES-27_COMPLETION.md` / `TECH_AUDIT.md` (api-gateway is a stub — correctly excluded from these manifests, from the CI build matrix, and from the Prometheus scrape config already). PG-004 (Vault integration) and PG-025 (Loki rollout) own the app-code and infra halves respectively of two gaps this package's manifests expose but does not itself close.

## Architecture

- Convert the existing 14 flat manifests into a single parameterized Helm chart (`infrastructure/helm/erp/`) with one values file per service (`values/auth-service.yaml`, etc.) plus a shared `values.yaml` for common defaults (resource tiers, Vault role naming convention, Loki/Jaeger endpoints, image registry/tag). Each service becomes one `helm template`/`helm install` invocation of a shared chart with per-service value overrides, not 14 divergent files.
- Add per-environment values overlays (`values-staging.yaml`, `values-production.yaml`) so replica counts, resource limits, and hostnames differ by environment without duplicating the whole chart — this is what PG-021's `deploy-staging` job should eventually target (`helm upgrade --install erp-staging ./infrastructure/helm/erp -f values-staging.yaml`), closing the loop on the path that job's commented-out code already assumed.
- Add an `Ingress` (or Istio `Gateway`/`VirtualService`, given the mesh is already assumed) resource per environment, fronting all 14 services under path or subdomain routing (e.g. `erp-staging.nexoraatech.com/api/auth/*` → `auth-service`), TLS terminated via the already-defined `cert-manager` `ClusterIssuer`s. This is also the natural future home for PG-001's api-gateway once it's real — design the Ingress/Gateway routing table so api-gateway can be swapped in as a single upstream later without re-deriving the whole routing table service-by-service.
- Extend `network-policy.yaml`'s existing `auth-service` ingress/egress pair pattern to all 13 remaining services (each needs: ingress from `erp-infra` namespace for health/metrics scraping, egress to Postgres/Redis/Kafka/Vault/Loki/Jaeger ports) — this is a mechanical extension of an already-correct pattern, not a new design.
- Component interactions: `ingress/Gateway → Service → Deployment (Vault-agent sidecar + app container) → {Postgres, Redis, Kafka, MinIO, ES} in erp-infra`. Prometheus/Loki/Jaeger scrape/receive from `erp-system` cross-namespace per the existing annotations and egress rules.

## Database Changes

Not applicable — no schema change. Purely Kubernetes/Helm/infra manifests.

## Backend

- No application code changes required for the Kubernetes packaging itself. Two adjacent, narrowly-scoped code touches are in-scope only if this package's own session has time and are otherwise explicitly deferred to their owning packages:
  - Do **not** implement Vault secret-sourcing in each service's container entrypoint here — that is PG-004's scope (it needs to decide the actual consumption mechanism: `source /vault/secrets/db && exec node ...` wrapper script vs. a Vault Agent Template writing `.env` vs. the Vault Kubernetes-native CSI driver). This package only ensures the k8s manifest side (ServiceAccount, agent-inject annotations, `vault-config.yaml` bootstrap) is internally consistent and documented as "manifest exists, app-side consumption is PG-004's job."
  - Do **not** deploy Loki here — that's PG-025. This package should update the `LOKI_URL` value to be Helm-templated (so it's not hard-coded per manifest) but should not stand up the Loki server itself.
- Health/readiness: all 14 services already expose `/health` via `registerHealthRoute` (`@erp/sdk`) — reuse as-is for probes; no new health-check code needed.
- Prometheus scraping: reuse the existing `prometheus.io/scrape`/`prometheus.io/port`/`prometheus.io/path` pod annotations already present in every manifest — carry them through unchanged into the Helm templates.

## Frontend

Not applicable — this package covers backend service packaging only. web-frontend/pos-frontend are static builds; if/when they need a Kubernetes-hosted deployment (vs. a CDN/static host), that is a separate, smaller follow-up package, not part of this XL package's scope.

## API Contract

Not applicable — no new REST endpoints. The only "contract" introduced is the Ingress routing table (path/host → service mapping), documented in the Helm chart's `values.yaml`.

## Multi-Tenant Considerations

- No change to the app-level tenant-isolation model (still `tenant_id` filtering in application code, no RLS, no per-tenant namespace/pod). Kubernetes-level isolation here is service-level and environment-level (staging vs. production namespaces), not tenant-level — this package must not conflate "namespace" with "tenant," which the existing `erp-system`/`erp-infra` split correctly avoids doing.
- HPA scaling is per-service, shared across all tenants on that service — a noisy-tenant scenario (one tenant driving disproportionate load) is not addressed by k8s-level autoscaling alone; that is a rate-limiting/quota concern already partially handled by the existing `@fastify/rate-limit` tenant-or-IP-keyed limiter in each service, not something this package needs to re-solve.

## Integration

- **All 14 backend services** — each gets a Helm-templated equivalent of its current standalone manifest.
- **PG-021 (CI staging deploy)** — should migrate from raw `kubectl apply -f infrastructure/k8s/` to `helm upgrade --install` against this package's chart once it exists; until then PG-021 is not blocked, it just has a manifest-shaped ceiling it will outgrow.
- **PG-001 (API Gateway)** — the Ingress/Gateway routing table this package builds should be designed so a future api-gateway can become the single upstream without re-deriving routing rules per service.
- **PG-004 (Vault)** and **PG-025 (Loki)** — this package's manifests reference both; it does not implement either, only keeps the references templated and clearly flagged as depending on those packages to become real.

## Coding Standards

- Helm chart conventions: standard `Chart.yaml`/`values.yaml`/`templates/` layout, one `_helpers.tpl` for shared label/selector templates (avoid 14 copies of the same `matchLabels` block). No custom templating engine or non-standard chart structure — this is a well-trodden Helm pattern, not a novel one.
- Keep the existing security posture (non-root, read-only rootfs, dropped capabilities, resource requests/limits) as chart defaults that cannot be silently disabled per-service without an explicit override — don't regress the hardening already present.

## Performance

- HPA already targets CPU 70% / memory 80% across all 14 services with min 2 / max 10 replicas — reuse these as chart defaults, tune per-service only where a service's own load profile is known to differ (e.g. `scheduler-service`'s BullMQ workers may need different concurrency-driven scaling signals than an HTTP-request-driven service — flag this as a tuning follow-up, not something to solve speculatively in this package).
- PodDisruptionBudgets (`minAvailable: 1`) already present — reuse as-is; ensures rolling node drains/upgrades don't take a service fully offline.

## Security

- Reuse and extend the existing `NetworkPolicy` pattern to all 13 services currently missing one (see Current Limitations #3) — this is the single highest-value security fix in this package, since a default-deny-all policy with only one service's allow-rules is a silent single point of breakage, not a working security boundary today.
- Cert-manager `ClusterIssuer`s already exist for TLS — wire the new Ingress/Gateway to actually request certs from `letsencrypt-prod`/`letsencrypt-staging` rather than leaving them unused.
- Vault-agent injection is present but not consumed (see Current Limitations #4) — flag clearly in the chart's documentation/README that this is a known half-wired state pending PG-004, so a future engineer doesn't assume secrets are actually flowing through Vault today.
- Istio `PeerAuthentication` (STRICT mTLS) already defined — note in this package's deliverable that Istio itself is not installed anywhere in this repo's IaC; either install it (adds significant scope) or explicitly descope Istio mTLS from this XL package's first pass and rely on Kubernetes `NetworkPolicy` alone for network segmentation, documenting that decision rather than leaving the policy files present-but-inert with no comment explaining why.

## Testing

- `helm lint infrastructure/helm/erp/` and `helm template infrastructure/helm/erp/ -f values-staging.yaml | kubeconform -strict` as CI-addable static validation (can be added to the existing `lint` job in `ci.yml`, or a new lightweight job — coordinate with PG-021 so both packages don't duplicate a "validate k8s manifests" step).
- Manual/session validation: `helm install --dry-run --debug` against a kind/minikube cluster for at least 2-3 representative services (a stateless HTTP service like `auth-service`, and the BullMQ-worker-shaped `scheduler-service`) before declaring the chart correct for all 14.
- No unit-test suite applies to Helm charts in this repo's existing test layout — validation here is manifest-linting + a real dry-run, not a Vitest suite.

## Acceptance Criteria

- [ ] `infrastructure/helm/erp/` is a valid Helm chart (`helm lint` passes) covering all 14 backend services with per-service value overrides, replacing the 14 flat manifests' duplication without changing their existing security posture.
- [ ] `helm template ... -f values-staging.yaml` and `-f values-production.yaml` both render successfully and differ only in the intended environment-specific fields (replica counts, resource limits, hostnames).
- [ ] An Ingress (or Istio Gateway/VirtualService) resource exists per environment, correctly referencing the existing `cert-manager` `ClusterIssuer`s, routing to all 14 services.
- [ ] `NetworkPolicy` ingress/egress rules exist for all 14 services (not just `auth-service`), following the existing pattern's shape.
- [ ] The chart's README explicitly documents the Vault-agent-injection-not-yet-consumed and Loki-URL-not-yet-deployed states as known, tracked gaps (pointing at PG-004/PG-025) rather than silently shipping half-wired references with no explanation.
- [ ] A decision on Istio (install it, or explicitly descope and rely on `NetworkPolicy` alone) is documented, not left ambiguous.

## Deliverables

- **Files to create:** `infrastructure/helm/erp/Chart.yaml`, `infrastructure/helm/erp/values.yaml`, `infrastructure/helm/erp/values-staging.yaml`, `infrastructure/helm/erp/values-production.yaml`, `infrastructure/helm/erp/templates/_helpers.tpl`, `infrastructure/helm/erp/templates/deployment.yaml` (templated, one file parameterized per service via values), `infrastructure/helm/erp/templates/service.yaml`, `infrastructure/helm/erp/templates/hpa.yaml`, `infrastructure/helm/erp/templates/pdb.yaml`, `infrastructure/helm/erp/templates/networkpolicy.yaml` (extended to all 14 services), `infrastructure/helm/erp/templates/ingress.yaml`, `infrastructure/helm/erp/README.md`.
- **Files to modify:** `infrastructure/k8s/network-policy.yaml` (extend pattern to remaining 13 services, if the raw-manifest path is kept in parallel during PG-021's transition period).
- **Migrations:** none.
- **APIs added/changed:** none (Ingress routing table is infra, not an API contract change).
- **Events added/changed:** none.
- **Tests added:** `helm lint` + `helm template | kubeconform` CI validation step.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `infrastructure/k8s/` already contains real, checked-in Kubernetes manifests for all 14 backend services (Deployment/Service/HPA/PDB/ServiceAccount each), plus shared `namespace.yaml`, `cert-manager.yaml`, `vault-config.yaml`, `backup-cronjob.yaml`, and a partial `network-policy.yaml` (only `auth-service` has actual allow-rules; the other 13 would be blocked by the default-deny-all policy if it were ever enforced). `infrastructure/istio/` has mTLS/authz policy resources but no Istio control-plane install exists anywhere. `infrastructure/helm/` and `infrastructure/terraform/` are empty (`.gitkeep` only) — there is genuinely no Helm chart and no cluster-provisioning IaC. Every service's manifest already references a Loki URL and Vault-agent-injection annotations, but neither Loki (see PG-025) nor real Vault secret consumption (see PG-004) exist yet — these manifests are ahead of what they're referencing.

**Current Objective:** Convert the 14 flat, duplicated manifests into one parameterized Helm chart, extend the `auth-service`-only `NetworkPolicy` pattern to all 14 services, add a real Ingress/Gateway with TLS via the already-defined cert-manager issuers, and document (not necessarily close) the Vault/Loki/Istio half-wired states so a future session doesn't mistake "annotation present" for "integration complete."

**Architecture Snapshot:**
1. This package's originating brief incorrectly assumed no k8s manifests existed — they do; this is a hardening/consolidation package, not a from-scratch build.
2. `erp-system` namespace hosts app workloads; `erp-infra` hosts Postgres/Redis/Kafka/MinIO/Vault/observability — don't conflate the two or with tenant isolation (there is no per-tenant namespace).
3. api-gateway is intentionally excluded everywhere (CI build matrix, Prometheus scrape config, and should remain excluded here) — it's a stub per ES-27.
4. Every service already exposes `/health` via `@erp/sdk`'s `registerHealthRoute` — reuse for probes, don't invent a new health mechanism.
5. Vault-agent-injection annotations exist in every manifest but no Dockerfile `CMD` sources the injected secret file — this is a known, documented, not-yet-closed gap (PG-004's scope).
6. Loki is referenced by URL in every manifest but not deployed anywhere (PG-025's scope).

**Completed Components:** The 14 raw per-service manifests, `namespace.yaml`, `cert-manager.yaml`, `vault-config.yaml`, `backup-cronjob.yaml`, and the `auth-service` `NetworkPolicy` pair — all reusable as the Helm chart's source material.

**Pending Components:** Helm chart itself, Ingress/Gateway, NetworkPolicy for the other 13 services, an Istio-install-or-descope decision, actual Vault/Loki wiring (explicitly out of scope here — PG-004/PG-025 own those).

**Known Constraints:** No live Kubernetes cluster is guaranteed available in a given dev session — validate via `helm lint`/`helm template`/`kubeconform` and a kind/minikube dry-run where possible; flag clearly if a real-cluster test could not be performed rather than claiming full validation.

**Coding Standards:** Standard Helm chart layout (`Chart.yaml`/`values.yaml`/`templates/`, shared `_helpers.tpl`); do not loosen the existing `securityContext` hardening while templating.

**Reusable Components:** The 14 existing manifests as the literal source to template from; the `auth-service` `NetworkPolicy` pair as the pattern to replicate; `cert-manager`'s existing `ClusterIssuer`s; `@erp/sdk`'s `/health` route.

**APIs Already Available:** `GET /health` on every service (probe target, not a new API).

**Events Already Available:** none relevant.

**Shared Utilities:** none new; no `@erp/*` package changes in this package's scope.

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Kubernetes-level constructs here are service/environment-scoped, not tenant-scoped — do not introduce per-tenant infra partitioning, which would contradict the shared-schema, app-layer-isolation model used everywhere else in this codebase.

**Security Rules:** Do not regress `runAsNonRoot`/`readOnlyRootFilesystem`/dropped-capabilities while converting to Helm. Extending `NetworkPolicy` to all 14 services is the single highest-priority security item in this package.

**Database State:** Not applicable.

**Testing Status:** No Helm-specific validation exists yet in CI — this package should add `helm lint`/`kubeconform` as a first step.

**Next Session Plan:** Split further given XL complexity — Session 1: Helm chart skeleton + templating all 14 services' Deployment/Service/HPA/PDB + `_helpers.tpl`. Session 2: NetworkPolicy extension to all 14 services + Ingress/Gateway + cert-manager wiring. Session 3: Istio install-or-descope decision + chart README documenting Vault/Loki known-gaps + CI validation step.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/003-Infrastructure/17-kubernetes-production-readiness.md` and implement PG-022 Session 1 (or whichever session is next per its own Next Session Plan): convert the existing `infrastructure/k8s/*.yaml` manifests into a parameterized Helm chart at `infrastructure/helm/erp/`. Re-verify the current state of `infrastructure/k8s/`, `infrastructure/helm/`, and `infrastructure/istio/` first — this package's own brief already corrected one wrong assumption (that no manifests existed) and there may be further drift since this file was written."
