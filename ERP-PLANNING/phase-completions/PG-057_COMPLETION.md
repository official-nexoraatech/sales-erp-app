# PG-057 — Production Deployment Runbook & Rollback Strategy — Completion Report

**Date:** 2026-07-11
**Status:** Runbook + tooling shipped. **Staging dry-run explicitly not performed** — no production-shaped cluster exists to run it against this session; see Deployment Checklist.

## Summary

Wrote `ERP-PLANNING/runbooks/production-deployment-runbook.md`: a pre-deploy checklist, a
dependency-tiered deploy sequence (migrations → auth/tenant → event-service → 11 leaf services
→ frontends), a smoke-test gate reusing PG-021's `scripts/ci/staging-smoke-test.sh` verbatim,
and a rollback procedure (application-only `kubectl rollout undo` as the default path;
`infrastructure/runbooks/dr-runbook.md`'s proven restore as the exception path for a
structurally-breaking migration with no prepared compensating migration).

Also added `scripts/check-pending-deployment-checklists.sh`, which mechanizes the
`- [ ] ... ` under `## Deployment Checklist` scan `CLAUDE.md` already mandates at AI-session
start — now a documented pre-deploy gate, not just a session-start habit. Ran it for real
(not a synthetic test): it found genuine unchecked items in 16 existing completion reports on
the first run.

## Corrections to the gap-prompt's own assumptions (verified this session, not carried over)

- **The stale `infrastructure/runbooks/dr-runbook.md` reference is no longer stale.** The
  gap-prompt (written before PG-024 landed) correctly identified it as a forward-reference that
  didn't exist yet — but PG-024 (2026-07-10) created it. Verified the file exists and read it in
  full; the new runbook cross-links to it instead of re-deriving or duplicating its restore
  procedure.
- **There is no production namespace, cluster, or CI job — and none is implied by naming.**
  `infrastructure/k8s/kustomization.yaml`'s own comment and the Helm chart's
  `values-production.yaml` (`namespace: erp-system`) both confirm environment separation in this
  repo is by _cluster/kubeconfig_, not by a differently-named namespace. The gap-prompt's draft
  commands assumed a `-n erp-production` namespace that doesn't exist anywhere. Corrected: the
  runbook's commands target `erp-system` on whatever cluster the production `KUBECONFIG` points
  at, and explicitly flags that no such second cluster/kubeconfig/CI job exists yet as a
  prerequisite, not a detail to paper over.
- **PG-022 is Session 1 only, and CI does not use the Helm chart.** Confirmed via the chart's own
  README: `deploy-staging` still runs `kubectl apply -k infrastructure/k8s/` against the original
  flat manifests. The runbook documents Kustomize as the actually-working mechanism today and
  notes the Helm chart as the not-yet-adopted future path, rather than writing the runbook as if
  Helm were already live.
- **There is no frontend deploy mechanism at all — a real gap, not a documentation omission.**
  Grepped `ci.yml` and `apps/{web-frontend,pos-frontend}/`: no `Dockerfile`, no build/publish job,
  no hosting target defined anywhere; CI only runs their unit/e2e tests. The gap-prompt's "deploy
  frontends last" step assumed a working artifact-publish path existed to sequence after backend
  — it doesn't. Documented this explicitly in the runbook's §2 rather than inventing a hosting
  mechanism unasked-for.
- **The `deploy-staging` job's registry is already GHCR, consistently.** Re-checked the
  gap-prompt's claimed "Docker Hub vs. GHCR mismatch" — that was PG-021's own finding, already
  fixed by the time PG-021 shipped. `build` and `deploy-staging` both use
  `ghcr.io/nexoraatech/erp/<service>` today; no mismatch remains to flag.
- **Concrete migration examples for the rollback decision rule, verified by reading the actual
  SQL** (not assumed from filenames): `0033_settings_updated_by.sql` (additive — three
  `ADD COLUMN IF NOT EXISTS`) and `0010_es06_hr_encryption_holidays.sql` (breaking — `ALTER
COLUMN ... TYPE text` on a previously-numeric payroll column, the same migration
  `ES-06_COMPLETION.md`'s own Deployment Checklist required a manual data-migration script for).

## Files touched

- `ERP-PLANNING/runbooks/production-deployment-runbook.md` — new.
- `scripts/check-pending-deployment-checklists.sh` — new.
- `ERP-PLANNING/production-gap-prompts/IMPLEMENTATION-NOTES.md` — new PG-057 entry.

## Verification performed this session

- `scripts/check-pending-deployment-checklists.sh` run against the real
  `ERP-PLANNING/phase-completions/` directory — correctly found unchecked `## Deployment
Checklist` items in 16 files (ES-20, ES-35, ES-36, ES-37, GLOBAL-SEARCH, PG-005, PG-024,
  PG-025, PG-026, PG-044, PG-045, PG-050, PG-051, PG-052, PG-053, PG-055) and correctly ignored
  unchecked boxes elsewhere in the tree (`PHASE_3/8/14_COMPLETION.md`, `ES-02_COMPLETION.md`) that
  sit under other headings, not `## Deployment Checklist` — confirmed by reading each file's
  heading structure before trusting the grep.
- Read `infrastructure/k8s/kustomization.yaml`, `namespace.yaml`, `infrastructure/helm/erp/README.md`
  and `values-production.yaml`, `scripts/ci/staging-smoke-test.sh`, `.github/workflows/ci.yml`'s
  full job list and `deploy-staging` body, `infrastructure/runbooks/dr-runbook.md`,
  `ERP-PLANNING/phase-completions/dr-drill-report.md`, and the two migrations cited above — every
  concrete command/example in the runbook is sourced from an actually-read file, not inferred.

## Deployment Checklist

> **⚠ These steps MUST be run manually before this runbook is trusted for a real incident. They are NOT automatic.**

- [ ] **Dry-run the full deploy sequence against a real second cluster** (a genuine
      production-shaped environment, or at minimum a second staging-like cluster) once one
      exists — confirm each ordering step (migrations → auth/tenant → event-service → 11 leaves →
      frontends) actually works as written. Not performed this session — no such cluster is
      provisioned anywhere yet.
- [ ] **Dry-run the application-only rollback path** — deploy a deliberately broken image tag,
      confirm `kubectl rollout undo` restores the previous revision and the smoke gate goes green
      again. Not performed this session, same constraint.
- [ ] **Provision a production `KUBECONFIG` secret and, if driving this from CI, a
      `deploy-production` job** gated by a stricter GitHub Environment protection rule than
      staging — this runbook documents the human-facing procedure around triggering such a job,
      it does not add one (out of this package's stated scope, matching the gap-prompt's own
      Integration section).
- [ ] **Build a frontend deploy mechanism** (Dockerfile/static-hosting target + CI publish job)
      before treating §2's "frontends deploy last" step as more than a documented gap.
- [ ] No new environment variables, no new migration, no new RBAC permission from this package
      itself — it is documentation plus one read-only shell script.
