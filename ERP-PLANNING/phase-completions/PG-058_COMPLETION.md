# PG-058 — Blue/Green or Canary Release Strategy — Completion Report

**Date:** 2026-07-11
**Status:** Closed as scoped. This package's own Deliverables section limits it to
documentation/evaluation until a concrete business driver greenlights implementation — no
`infrastructure/k8s` or CI changes were made, matching Acceptance Criteria's explicit "no
infrastructure built prematurely" bar.

## Summary

Re-confirmed the gap-prompt's own recommendation and scope decision, and closed its one
genuinely open unknown (the actual contents of `infrastructure/istio/`).

## Findings this session

- **`infrastructure/istio/` is neither of the two outcomes the gap-prompt anticipated.** It
  is not `.gitkeep`-only scaffolding (unlike `infrastructure/helm/` at the time PG-021 checked
  it) — it holds two real manifests:
  - `peer-authentication.yaml`: namespace-wide `PeerAuthentication` set to `STRICT` mTLS, plus
    a `PERMISSIVE` port-9090 carve-out for Prometheus scraping.
  - `authorization-policy.yaml`: a default-deny `AuthorizationPolicy`, plus explicit allows for
    API-gateway→auth-service token calls, health-check GETs, and Prometheus scraping.

  But per `infrastructure/helm/erp/README.md`'s own "Known gaps" section: **no Istio
  control-plane install exists anywhere in this repo's IaC**, so these policies are not
  actually enforced today — Kubernetes `NetworkPolicy` is the only network segmentation
  actually in effect (and per that same README, `NetworkPolicy` itself only covers
  `auth-service` so far, the other 13 services have no matching allow-rules yet).

  Separately, and more directly relevant to this package: a repo-wide grep for
  `VirtualService`/`DestinationRule`/`kind: Gateway` under `infrastructure/` returned **zero
  matches**. There is no traffic-splitting configuration of any kind. So for the purposes
  this package actually cares about (canary traffic-shifting), the existing Istio manifests
  provide no head start — they were written for mTLS/authorization, not release routing, and
  a canary implementation would need to build the traffic-splitting layer (and separately
  decide whether to actually install the Istio control plane at all — a decision PG-022
  Session 3 explicitly owns, not this package) entirely from scratch.

- **PG-057 (this package's dependency) has shipped** (2026-07-11, same day). The production
  deployment runbook and rollback tooling
  (`ERP-PLANNING/runbooks/production-deployment-runbook.md`,
  `scripts/check-pending-deployment-checklists.sh`) exist. Its own Deployment Checklist still
  lists unresolved items — no second/production cluster or `KUBECONFIG` provisioned, staging
  dry-run of the deploy sequence and the rollback path not performed, no frontend deploy
  mechanism exists. None of these block PG-058's own scope (a decision document), but they
  matter if this package is ever picked up for real implementation: blue/green would need a
  second full cluster/environment to cut over between, and none is provisioned yet.

- **PG-022 is confirmed Session-1-only**, per its own README: chart skeleton +
  Deployment/Service/HPA/PDB/ServiceAccount templating for all 14 services exists and renders
  correctly (`helm lint`/`helm template` verified, no live cluster), but CI's `deploy-staging`
  job still runs `kubectl apply -k infrastructure/k8s/` against the original flat Kustomize
  manifests — the Helm chart is not wired into any deploy path yet. Ingress/Gateway,
  NetworkPolicy extension to the other 13 services, and the Istio install-or-descope decision
  are explicitly deferred to PG-022 Session 2/3.

## Decision re-confirmed (not re-litigated from scratch)

- **Blue/green over canary** remains the right call for this system: no traffic-shaping
  infrastructure exists today (now confirmed, not assumed — see Istio finding above), 14
  services is a lot of surface for a fine-grained canary promotion policy, and this system's
  business-hours ERP usage pattern doesn't need canary's gradual-exposure benefit as much as a
  high-traffic consumer product would.
- **This package stays filed under Phase 9 (Enterprise Enhancements), not Phase 8.** No
  concrete customer/business driver naming a contractual zero-downtime/uptime SLA requirement
  has surfaced. PG-057's rolling-deploy-plus-rollback runbook remains the actual Phase 8
  production-readiness deliverable.
- The binding constraint stays unchanged: with one shared Postgres and no per-tenant/per-version
  schema isolation, any future zero-downtime strategy requires every migration to stay
  compatible with both the old and new application version for the full cutover window — this
  is a process discipline to impose on `packages/db-client/migrations` if/when this is ever
  adopted, not something this package builds now.

## Files touched

- `ERP-PLANNING/production-gap-prompts/016-Deployment/56-blue-green-canary-release-strategy.md`
  — Existing Code Analysis's Istio bullet rewritten with verified findings; Acceptance Criteria
  checked off; Context Preservation's Previous Work Summary and Architecture Snapshot updated
  to reflect PG-057/PG-022's actual landed state instead of "check first" placeholders.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-058 entry.
- `ERP-PLANNING/phase-completions/PG-058_COMPLETION.md` — new (this file).

## Verification performed this session

- `ls infrastructure/istio/` — confirmed 3 files (`.gitkeep` + the two manifests above), read
  both manifests in full.
- Grepped `infrastructure/` for `VirtualService|DestinationRule|kind: Gateway` — zero matches.
- Read `infrastructure/helm/erp/README.md` in full (Chart.yaml/templates existence,
  "Known gaps" section) to confirm PG-022's real landed scope rather than trusting memory.
- Read `ERP-PLANNING/phase-completions/PG-057_COMPLETION.md` in full, including its
  Deployment Checklist, to confirm PG-057's actual shipped state and open items.

## No implementation performed (by design)

No `infrastructure/k8s` manifests, Helm templates, CI jobs, or migration-linting tooling were
added. This matches the gap-prompt's own Deliverables ("none beyond this gap-prompt file
itself... until a concrete business driver greenlights implementation") and Acceptance
Criteria ("No blue/green/canary infrastructure is built prematurely").

## Deployment Checklist

Not applicable — no infrastructure, migration, or config changes were made by this package.
