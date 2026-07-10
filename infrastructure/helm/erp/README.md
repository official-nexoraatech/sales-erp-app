# erp Helm chart

Parameterized Helm chart for the ERP platform's 14 backend services. Templates the
Deployment / Service / HorizontalPodAutoscaler / PodDisruptionBudget / ServiceAccount shape
that already exists, hand-duplicated, across `infrastructure/k8s/*.yaml` — one values entry
per service instead of one YAML file per service.

**This is PG-022 Session 1 only.** See
`ERP-PLANNING/production-gap-prompts/003-Infrastructure/17-kubernetes-production-readiness.md`
for the full package and its "Next Session Plan". Session 1 scope: chart skeleton +
Deployment/Service/HPA/PDB/ServiceAccount templating for all 14 services. NetworkPolicy
extension, an Ingress/Gateway, and the Istio install-or-descope decision are **not** in this
chart yet — that's Session 2/3.

## What's in this chart

- `Chart.yaml`, `values.yaml` — chart metadata and defaults, copied field-for-field from the
  existing manifests (see `values.yaml` comments for the per-service source data: port,
  env var name, Vault role, JWT key shape).
- `values-staging.yaml` / `values-production.yaml` — environment overlays. Production
  intentionally restates the same numbers already in `infrastructure/k8s/` (this chart isn't
  a scale-up); staging scales replicas/resources down. Neither sets a hostname — there's no
  Ingress template yet (see "Known gaps" below).
- `templates/_helpers.tpl` — shared label/selector/image/resources helpers, plus the two Vault
  Agent template blocks (`erp.vaultDbBlock`, `erp.vaultJwtBlock`). Those two are the trickiest
  part of this chart: the `{{ }}` inside them is Vault Agent's own template syntax, evaluated
  by the Vault sidecar at pod-start time, not by Helm — so the helper emits those braces as
  literal text via the `{{ "{{" }}` / `{{ "}}" }}` pattern rather than letting Helm try to
  evaluate them. Verified via `helm template` that the rendered output matches the original
  manifests' Vault annotations byte-for-byte.
- `templates/deployment.yaml`, `service.yaml`, `hpa.yaml`, `pdb.yaml`, `serviceaccount.yaml`
  — each ranges over `.Values.services` and emits one resource of that kind per service.

### What is deliberately NOT templated here

`infrastructure/k8s/namespace.yaml`, `network-policy.yaml`, `cert-manager.yaml`,
`vault-config.yaml`, and `backup-cronjob.yaml` stay as the existing raw manifests and are
applied alongside this chart (`kubectl apply -f infrastructure/k8s/namespace.yaml`, etc.) —
per PG-022's own "Existing Code Analysis", these are reused as-is, not converted.

## Usage

```sh
helm lint infrastructure/helm/erp/
helm template erp infrastructure/helm/erp/                                    # base/prod-shaped defaults
helm template erp infrastructure/helm/erp/ -f infrastructure/helm/erp/values-staging.yaml
helm template erp infrastructure/helm/erp/ -f infrastructure/helm/erp/values-production.yaml
```

To pin a real release image tag (mirrors what `deploy-staging` in `ci.yml` does today via
`kustomize edit set image` against `infrastructure/k8s/kustomization.yaml`):

```sh
helm upgrade --install erp infrastructure/helm/erp/ \
  -f infrastructure/helm/erp/values-production.yaml \
  --set global.imageTag=1.4.2
```

`infrastructure/k8s/*.yaml` + `kustomization.yaml` are untouched and still work — CI's
`kubectl apply -k infrastructure/k8s/` path is not migrated to this chart yet. That migration
is PG-021's job, once it chooses to re-point at this chart (see the gap-prompt's Integration
section).

## Validation performed this session

- `helm lint` — passes (base, `values-staging.yaml`, `values-production.yaml`).
- `helm template` — renders successfully for base and both overlays, no live cluster needed.
- Manually diffed the rendered `auth-service` and `report-service` Deployments against
  `infrastructure/k8s/auth-service.yaml` / `report-service.yaml` field-by-field, including the
  Vault Agent annotation template bodies — identical modulo YAML key ordering (`toYaml`
  alphabetizes map keys; semantically irrelevant to Kubernetes).
- Diffed the full `helm template` output for base vs. `values-production.yaml` — byte-identical,
  confirming the production overlay doesn't silently change anything.

**Not performed this session** (no Kubernetes cluster or `kubeconform` binary available):
`helm install --dry-run --debug` against a real/kind cluster, and `kubeconform -strict` schema
validation. Both are still open items — see the parent gap-prompt's Testing section and PG-022's
Session 3 plan for adding `kubeconform` to CI.

## Known gaps (carried over from the parent gap-prompt, not closed by this chart)

- **No Ingress/Gateway** — this chart has no `templates/ingress.yaml` yet. There's still no
  resource routing `erp-staging.nexoraatech.com` (referenced by `ci.yml`'s `deploy-staging`
  job) to any service. PG-022 Session 2.
- **NetworkPolicy still only covers `auth-service`** — `infrastructure/k8s/network-policy.yaml`
  is untouched by this chart; the other 13 services still have no matching allow-rules against
  the namespace's default-deny-all policy. PG-022 Session 2.
- **Vault-agent injection is present but not consumed.** Every Deployment this chart renders
  still carries the same `vault.hashicorp.com/agent-inject-template-*` annotations as the
  original manifests — but no service's container entrypoint sources the file Vault Agent
  writes (`node apps/<service>/dist/main.js` is a bare command). `DATABASE_URL` is also set as
  a plain env var elsewhere. These annotations are decorative until PG-004 implements real
  consumption. Do not assume secrets are flowing through Vault today.
- **`LOKI_URL` points at a service that isn't deployed anywhere** (`loki.erp-infra.svc.cluster.local:3100`).
  See PG-025.
- **Istio `PeerAuthentication`/`AuthorizationPolicy` exist in `infrastructure/istio/` but no
  Istio control-plane install is present anywhere in this repo's IaC.** This chart does not
  install Istio and does not make an install-or-descope decision — that's explicitly deferred
  to PG-022 Session 3, per the parent gap-prompt's Security section. Until that decision is
  made and documented, treat the mesh-level mTLS policies as not actually enforced; Kubernetes
  `NetworkPolicy` (once extended to all 14 services in Session 2) is the only network
  segmentation actually in effect.
