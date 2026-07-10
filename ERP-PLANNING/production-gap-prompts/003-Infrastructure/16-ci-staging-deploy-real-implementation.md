# [PG-021] CI Staging Deploy — Real Implementation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Deployment
**Priority:** Critical
**Complexity:** M — one CI job to make real, but it must correctly sequence Kubernetes rollouts across 14 services with a working rollback and smoke gate; no new service code, but real infra wiring and secrets provisioning.
**Depends on:** none (functionally needs `infrastructure/k8s/*.yaml` to exist, which it already does — see Existing Code Analysis; PG-022 will formalize those manifests into a versioned Helm chart, and this package should be re-pointed at that chart once PG-022 lands, but is not blocked from shipping against the raw manifests today)
**Blocks:** none
**Primary service(s)/package(s):** `.github/workflows/ci.yml`, `infrastructure/k8s/*.yaml`, all 14 backend services (image consumers), `apps/*/Dockerfile`

---

## Overview

- **Business objective:** Right now, merging and tagging a release does not deploy anything. The only artifact of a `v*` tag is a log line (`echo "Deploying version ... to staging"`) — every actual `kubectl`/`helm` command is commented out. There is no automated, repeatable path from "PR merged to main and tagged" to "running in a reachable staging environment." Every deploy today would have to be a manual, undocumented, tribal-knowledge action by whoever has cluster access — which is both a production-readiness gap and a bus-factor risk.
- **Current implementation:** `.github/workflows/ci.yml` lines 382–408, job `deploy-staging`:
  ```yaml
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: [security-scan]
    if: startsWith(github.ref, 'refs/tags/v')
    environment:
      name: staging
      url: https://erp-staging.nexoraatech.com
    steps:
      - uses: actions/checkout@v4
      - name: Extract tag version
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/}" >> $GITHUB_OUTPUT
      - name: Deploy to Kubernetes staging
        run: |
          echo "Deploying version ${{ steps.version.outputs.version }} to staging"
          # kubectl set image deployment/auth-service auth-service=nexoraatech/erp-auth-service:${{ steps.version.outputs.version }} -n erp-staging
          # helm upgrade --install erp-staging ./infrastructure/helm/erp \
          #   --namespace erp-staging \
          #   --set global.imageTag=${{ steps.version.outputs.version }} \
          #   --wait --timeout 5m
        env:
          KUBECONFIG: ${{ secrets.KUBECONFIG_STAGING }}
  ```
  The job already has the right shape (gated on `needs: [security-scan]`, gated on a `v*` tag, a GitHub `environment: staging` with a URL, and a `KUBECONFIG` secret reference already declared) — but the body is 100% comment. Nothing runs against the cluster. The commented-out `helm upgrade` line also references `./infrastructure/helm/erp`, a path that **does not exist** — `infrastructure/helm/` contains only a `.gitkeep` (verified via `Glob`). Whoever wrote this stub assumed a Helm chart that was never built (that's PG-022's job).
  What **does** already exist and is real, not a stub: `infrastructure/k8s/*.yaml` — 14 raw Kubernetes manifests (one per backend service, e.g. `auth-service.yaml`, `sales-service.yaml`, …), each containing a `Deployment` + `Service` + `HorizontalPodAutoscaler` + `PodDisruptionBudget` + `ServiceAccount`, plus `namespace.yaml`, `network-policy.yaml`, `cert-manager.yaml`, `vault-config.yaml`, and `backup-cronjob.yaml`. These are real, checked-in, production-shaped manifests — not a greenfield problem. This corrects an assumption in the originating gap description ("assume Kubernetes... depends on PG-022's readiness work"): Kubernetes is not just assumed, raw manifests for it already exist in this repo today. What's missing is CI actually applying them anywhere.
- **Current architecture:** The Docker build/push matrix job (`build`, lines 182–241) already builds and pushes all 14 service images (api-gateway excluded — it's a stub, see `ES-27_COMPLETION.md`) to Docker Hub (`nexoraatech/erp-<service>`) tagged by branch, PR, semver, and SHA — but only pushes `if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'`. The k8s manifests, however, pull images from `ghcr.io/nexoraatech/erp/<service>:latest` (see `infrastructure/k8s/auth-service.yaml` line 47) — a **different registry and a different tag** than what CI actually publishes. This mismatch must be fixed as part of this package, not just the missing deploy step.
  `deploy-staging` runs after `security-scan` (Trivy), which itself runs after `build`, which runs after `test`+`lint`+`type-check` — so the dependency chain to reach deploy is already correct; only the deploy body is missing.
- **Current limitations:** Concretely: (1) the `kubectl`/`helm` commands are commented out — nothing is applied to any cluster; (2) the commented `helm upgrade` targets a Helm chart that doesn't exist; (3) even if uncommented as-is, the `kubectl set image` line only touches `auth-service`, not the other 13; (4) no smoke test runs after "deploy" to confirm anything actually came up; (5) no rollback path is defined if a bad image is rolled out; (6) the image registry CI pushes to (Docker Hub) doesn't match the registry the k8s manifests reference (GHCR).

## Existing Code Analysis

- **What already exists and should be reused:**
  - `infrastructure/k8s/*.yaml` (14 service manifests + `namespace.yaml`, `network-policy.yaml`, `cert-manager.yaml`, `vault-config.yaml`, `backup-cronjob.yaml`) — reuse these directly via `kubectl apply -k` (a light Kustomize overlay) rather than inventing new manifests. Building a Helm chart from these is explicitly PG-022's job, not this one.
  - The `build` job's `docker/metadata-action@v5` tagging scheme (`type=sha,prefix=sha-`, `type=semver,pattern={{version}}`) — reuse the `sha-<GITHUB_SHA>` or semver tag as the exact image reference this job deploys, so staging always runs a traceable, CI-built artifact.
  - `registerHealthRoute` (`@erp/sdk`) — every service already exposes `GET /health` (used by the k8s `livenessProbe`/`readinessProbe` in every manifest, and already proven reachable in `ERP-PLANNING/phase-completions/dr-drill-report.md` Step 3.2, which curled 11 services' `/health` and got `"ok"` for all). Reuse this exact endpoint as the CI post-deploy smoke gate.
  - `environment: { name: staging, url: https://erp-staging.nexoraatech.com }` already declared on the job — GitHub Environments support required reviewers and environment-scoped secrets; reuse this rather than inventing a separate approval mechanism.
- **What should never be modified:** The `build` and `security-scan` matrix jobs' service lists (14 services, api-gateway excluded) — this package only adds a consumer of their output, it does not change what gets built or scanned. The existing `lint`/`type-check`/`test`/`e2e` jobs are untouched.
- **Prior related work:** `ERP-PLANNING/phase-completions/dr-drill-report.md` already proves the restore-and-boot sequence for all 14 services works end-to-end from a cold backup, which is a useful reference for "what does healthy look like" when writing the post-deploy smoke gate. `ES-27_COMPLETION.md` documents why api-gateway is excluded from the build matrix — the same exclusion applies here.

## Architecture

- Target platform: **Kubernetes**, deploying the already-checked-in `infrastructure/k8s/*.yaml` manifests via `kubectl apply -k infrastructure/k8s/` (add a minimal `infrastructure/k8s/kustomization.yaml` listing the 14 service files + shared resources, with a `images:` override block so CI can pin the exact tag per deploy without hand-editing 14 files). This avoids inventing a Helm chart (PG-022's scope) while still giving CI one command to apply everything atomically-ish.
- Flow per staging deploy (triggered on `refs/tags/v*`, same as today):
  1. `needs: [security-scan]` (unchanged) — nothing deploys until Trivy/Semgrep/Snyk/TruffleHog/dependency-audit all pass on `main`.
  2. Authenticate to the cluster: decode `secrets.KUBECONFIG_STAGING` (already declared) to a temp kubeconfig file; do not print it.
  3. Re-tag/push (or verify existing) the just-built images under the registry the manifests actually pull from — see Backend section for the registry-mismatch fix.
  4. `kubectl apply -k infrastructure/k8s/ -n erp-staging` (idempotent — creates or updates all Deployments/Services/HPAs/PDBs), then `kubectl set image` per service to the tag being released (via the kustomize `images:` override, one `kubectl` call, not 14).
  5. `kubectl rollout status deployment/<svc> -n erp-staging --timeout=180s` for each of the 14 services (fail the job if any rollout doesn't complete — this is the rollback trigger).
  6. Smoke gate: `curl -sf https://erp-staging.nexoraatech.com/<service-path>/health` (or in-cluster `kubectl run` curl pod hitting each Service's ClusterIP) for all 14 `/health` endpoints; fail the job on any non-200.
  7. On failure at step 5 or 6: `kubectl rollout undo deployment/<svc> -n erp-staging` for whichever service(s) failed, then fail the job loudly (not silently roll back and report green).
- This is a linear extension of the existing job — no new architectural pattern, no saga/outbox involvement (this is pure CI/CD, not application data flow).

## Database Changes

Not applicable — no schema change. This package touches CI and Kubernetes manifests only.

## Backend

- **Registry mismatch fix (must happen first):** `infrastructure/k8s/*.yaml` all reference `ghcr.io/nexoraatech/erp/<service>:latest`, but `ci.yml`'s `build` job pushes to `nexoraatech/erp-<service>` on Docker Hub. Pick one registry and make both sides agree — recommend switching CI to push to GHCR (`ghcr.io`) using the already-available `secrets.GITHUB_TOKEN` (avoids managing a separate Docker Hub credential for staging pulls and lets `imagePullSecrets` be scoped to the same GitHub org), OR keep Docker Hub and update all 14 `infrastructure/k8s/*.yaml` `image:` fields to `nexoraatech/erp-<service>`. Either way, stop shipping manifests that reference an image that is never actually published there — that's a live path-not-found deploy failure waiting to happen, distinct from the "commands are commented out" gap but caught by the same fix.
- Add `infrastructure/k8s/kustomization.yaml` (new file) referencing all 14 service manifests + `namespace.yaml` + `network-policy.yaml`, with an `images:` block for per-deploy tag overrides (`kustomize edit set image ghcr.io/nexoraatech/erp/auth-service=ghcr.io/nexoraatech/erp/auth-service:sha-<sha>` run once per service in a loop, or a single `images:` list templated in CI before `kubectl apply -k`).
- No application code changes to any of the 14 services. This is CI + manifest wiring only.
- Telemetry: emit a GitHub deployment status (`gh api repos/:owner/:repo/deployments` or the built-in `environment:` deployment tracking, which GitHub already surfaces automatically from the `environment:` block) so staging deploy history is visible in the repo's Deployments tab without extra tooling.

## Frontend

Not applicable — backend/infra-only gap. (web-frontend and pos-frontend are static builds served independently; if they need their own staging deploy step, that is a separate, smaller follow-up, not part of this package's k8s-manifest-driven backend deploy.)

## API Contract

Not applicable — no new REST endpoints. This package's only "interface" is the CI job's shell steps and the `kubectl`/GitHub Deployments API calls they make.

## Multi-Tenant Considerations

Not applicable at the CI-job level — staging is a single shared environment serving test tenants, same isolation model as production (app-layer `tenant_id` filtering, no per-tenant infra). No new tenant-isolation concern is introduced by this package.

## Integration

- **`.github/workflows/ci.yml`** — the only file with logic changes (the `deploy-staging` job body, and possibly the `build` job's registry target).
- **`infrastructure/k8s/*.yaml`** — new `kustomization.yaml`; existing 14 service manifests get their `image:` field's registry corrected if Docker Hub is chosen over GHCR.
- **GitHub Environments (`staging`)** — reuse the existing `environment: { name: staging }` block; recommend adding required-reviewer protection rules in repo settings (not a code change, an org/repo configuration change) so a human approves before the job proceeds, given this is the first time any tag actually touches a live cluster.
- No Kafka/outbox/event involvement — this is infra CI/CD, not a business workflow.

## Coding Standards

- This package is YAML (GitHub Actions + Kubernetes/Kustomize), not TypeScript — "coding standards" here means: match the existing `ci.yml` step-naming and comment-banner style (`# ─── Section Name ──`), keep secrets referenced via `${{ secrets.X }}` never inlined, and follow the same `needs:`/`if:` gating pattern already used by every other job in the file. No new CI framework (e.g. no switching to a separate CD tool like ArgoCD/Flux in this package — that would be a bigger architectural change belonging in PG-022 or a dedicated GitOps package, not this one).

## Performance

- `kubectl rollout status --timeout=180s` per service caps total worst-case deploy time at 14×180s if every service were to hang sequentially; recommend running the 14 `rollout status` checks with `kubectl rollout status ... &` backgrounded and `wait`, so slow services don't serialize the whole job past a reasonable CI timeout (~10-15 min total is a reasonable target for a staging deploy).
- No caching/indexing/batching concerns — this is a deploy job, not a data-processing job.

## Security

- `KUBECONFIG_STAGING` secret is already declared — verify it is scoped to a **staging-only** service account with RBAC limited to the `erp-staging` namespace (not cluster-admin). This should be checked/created as part of this package, not assumed to already be least-privilege.
- Add the registry pull credential (`imagePullSecrets`) as a separate secret from `KUBECONFIG_STAGING` so a leaked kubeconfig doesn't also leak registry push/pull credentials.
- The GitHub `environment: staging` block supports required reviewers — configure at least one required reviewer for this environment given it is the first automated write path into a running cluster this repo has ever had.
- No new OWASP category introduced — this hardens CI/CD supply-chain integrity (matches the existing Trivy/Semgrep/Snyk/TruffleHog jobs this deploy already depends on via `needs: [security-scan]`).

## Testing

- Add a smoke-test script (new file, e.g. `scripts/ci/staging-smoke-test.sh`) that curls all 14 `/health` endpoints and fails non-zero on any non-`ok` response — reuse this same script as both the CI post-deploy gate and a local/manual staging-health-check tool.
- No unit tests needed for a shell/YAML change; validate by a dry run: `kubectl apply -k infrastructure/k8s/ --dry-run=server -n erp-staging` in a throwaway namespace before wiring the real job, and a manual first execution of the completed job against a real (or kind/minikube) staging-like cluster before trusting it unattended.
- Add a `kubeval`/`kubeconform` or `kustomize build infrastructure/k8s/` lint step to the existing `lint` job (or a small new CI step) so malformed manifests fail fast on every PR, not just on the rare tagged-release path.

## Acceptance Criteria

- [ ] `kustomize build infrastructure/k8s/` succeeds locally and produces valid manifests for all 14 services + shared resources.
- [ ] Pushing a `v*` tag triggers `deploy-staging`, and the job actually runs `kubectl apply` / rollout commands (no commented-out lines remain).
- [ ] All 14 services' images referenced in `infrastructure/k8s/*.yaml` resolve to the same registry/tag scheme that `ci.yml`'s `build` job actually publishes to (verified by a successful `kubectl set image` + `rollout status` against a real or kind cluster).
- [ ] After a real tagged deploy, all 14 `/health` endpoints return `200 {"status":"ok"}` (or the smoke-test script exits 0).
- [ ] A deliberately broken image tag triggers automatic `kubectl rollout undo` and the CI job fails loudly (not silently green) with a clear log message identifying which service failed.
- [ ] The `staging` GitHub Environment shows a deployment record with the correct commit SHA/tag after a successful run.

## Deliverables

- **Files to create:** `infrastructure/k8s/kustomization.yaml`, `scripts/ci/staging-smoke-test.sh`.
- **Files to modify:** `.github/workflows/ci.yml` (`deploy-staging` job body; possibly `build` job's registry target), all 14 `infrastructure/k8s/*.yaml` (only if the registry choice requires changing their `image:` field).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** `scripts/ci/staging-smoke-test.sh` (used both as CI gate and manual tool); optional `kubeconform`/`kustomize build` lint step added to the `lint` job.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** The CI pipeline (`.github/workflows/ci.yml`) has 11 real, working jobs — lint, type-check, test (with real Postgres/Redis containers and an 80% coverage gate), Playwright E2E smoke, a 14-service Docker build/push matrix, dependency audit, Semgrep SAST, Trivy image scan, TruffleHog secrets scan, and Snyk scan. The 12th job, `deploy-staging`, exists structurally (correct `needs:`, correct tag-trigger `if:`, a GitHub `environment: staging` block, a `KUBECONFIG_STAGING` secret reference) but its body is entirely commented-out `kubectl`/`helm` placeholder lines — nothing has ever actually deployed anywhere via this pipeline. Separately, and not obviously connected to this CI file, `infrastructure/k8s/` already contains real, production-shaped Kubernetes manifests for all 14 backend services (Deployment + Service + HPA + PDB + ServiceAccount each), plus namespace/network-policy/cert-manager/vault-config/backup-cronjob resources — but nothing in CI ever applies them.

**Current Objective:** Make `deploy-staging` actually deploy: apply the existing `infrastructure/k8s/*.yaml` manifests to a real staging cluster via `kubectl`/Kustomize (not Helm — that's a separate future package), fix the image-registry mismatch between what CI publishes (Docker Hub, `nexoraatech/erp-<service>`) and what the manifests pull (GHCR, `ghcr.io/nexoraatech/erp/<service>:latest`), add a rollout-status gate, a post-deploy `/health` smoke test across all 14 services, and an automatic rollback on failure.

**Architecture Snapshot:**
1. `ci.yml`'s `build` job already builds+pushes all 14 service images (api-gateway excluded, still a stub per ES-27) — reuse its tags, don't rebuild.
2. `infrastructure/k8s/*.yaml` manifests already exist and are real — this package applies them, it does not author them from scratch.
3. Every service exposes `GET /health` via `registerHealthRoute` (`@erp/sdk`) — already proven reachable in `dr-drill-report.md`.
4. `infrastructure/helm/` is empty (`.gitkeep` only) — do not write Helm templates in this package; that's PG-022.
5. `KUBECONFIG_STAGING` secret and the `staging` GitHub Environment are already declared in `ci.yml` — reuse, don't re-declare.

**Completed Components:** The Kubernetes manifests themselves (`infrastructure/k8s/*.yaml`) — treat as given raw material, not something to redesign here (that's PG-022's remit if they need hardening/Helm-ification).

**Pending Components:** Helm chart authoring, HPA/probe hardening, ingress strategy, Vault-agent-injection correctness (the manifests already have Vault agent-inject annotations, but no app code actually sources the injected secret file — that inconsistency belongs to PG-022/PG-004, not this package). Do not attempt to fix Vault wiring here.

**Known Constraints:** No live cluster is available to test against in most dev sessions (see `[[es24_no_live_db_available]]`-style constraint) — validate manifests with `kustomize build`/dry-run, and flag that a real cluster test is required before this is trusted in production, don't claim it "works" without one.

**Coding Standards:** Match `ci.yml`'s existing step style (comment banners, `needs:`/`if:` gating). No new CD tool (ArgoCD/Flux) introduced in this package.

**Reusable Components:** `docker/metadata-action@v5` tag output from the `build` job; `registerHealthRoute` `/health` endpoint on every service; `KUBECONFIG_STAGING` secret; `environment: staging` block.

**APIs Already Available:** Every service's `GET /health` (used as the smoke gate, not a new endpoint).

**Events Already Available:** none relevant — this is not an event-driven workflow.

**Shared Utilities:** none new; this package does not touch `@erp/*` packages.

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Not applicable — staging is a single shared environment, same isolation model as production.

**Security Rules:** `KUBECONFIG_STAGING` must be scoped to a staging-only, least-privilege service account (verify/fix as part of this package, don't assume it already is).

**Database State:** Not applicable — no schema involvement.

**Testing Status:** No smoke-test script exists yet for post-deploy validation — this package creates the first one.

**Next Session Plan:** Single session. If cluster access is unavailable, complete the manifest/kustomize/CI-YAML changes and a dry-run validation, and explicitly flag "requires a live cluster test before merge" rather than declaring done.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/003-Infrastructure/16-ci-staging-deploy-real-implementation.md` and implement PG-021: make the `deploy-staging` job in `.github/workflows/ci.yml` actually run `kubectl`/Kustomize against the existing `infrastructure/k8s/*.yaml` manifests, fix the Docker Hub vs GHCR image-registry mismatch between the `build` job and the k8s manifests, add a rollout-status + `/health` smoke-test gate across all 14 services, and an automatic rollback on failure. Re-verify the current state of `ci.yml` and `infrastructure/k8s/` first — do not assume this file's line numbers are still accurate."
