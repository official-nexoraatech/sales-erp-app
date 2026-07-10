# ES-27 — CI/CD, Docker & Kubernetes Deployability
## STATUS: ✅ COMPLETE — see phase-completions/ES-27_COMPLETION.md
## Sprint: 7 | Effort: 5–7 days | Risk: High (nothing but auth-service can currently be deployed)
## Depends on: ES-21..ES-26 not strictly required, but this phase is most valuable done LAST since
##             it packages/deploys the code those phases fix — running it first just means rebuilding
##             images again after each of those phases
## Unlocks: any real staging/production deployment
## Source: `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` findings C11, H2, H5, H6, M12, M13, L5, L6

---

## YOUR ROLE

You are the **Principal DevOps/Platform Engineer** on the NEXORAA Multi-Tenant Cloth Retail ERP.

The 2026-07-03 architecture audit found that this platform's CI/CD and deployment story is
**almost entirely aspirational**: the CI build matrix references Dockerfiles that exist for only 1
of 13 backend services, Kubernetes manifests exist for only 1 of 15 services, the `api-gateway`
service referenced by production infrastructure config doesn't actually exist (4-line stub), a
documented Postgres reliability fix was never actually applied, and there's no automated backup job
anywhere despite a well-executed manual DR drill. This phase makes the deployment story match
reality — either by building out what's missing or by making the CI matrix and infra manifests
honest about current scope.

**This phase has more raw volume (14 services × Dockerfile + K8s manifest) than complexity per
item — use `apps/auth-service/Dockerfile` and `infrastructure/k8s/auth-service.yaml` as your
template and replicate carefully, don't reinvent per service.**

---

## ═══════════════════════════════════════════
## PRE-FLIGHT CHECKLIST
## ═══════════════════════════════════════════

- [ ] Read `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` §2 (C11), §3 (H2, H5, H6), §4 (M12, M13),
      §5 (L5, L6)
- [ ] Read `apps/auth-service/Dockerfile` in full — the correct template (multi-stage, non-root
      user, HEALTHCHECK) — confirmed correct by the audit
- [ ] Read `infrastructure/k8s/auth-service.yaml` in full — the correct template (resource
      requests/limits, liveness/readiness probes, HPA 2-10 replicas @ 70% CPU/80% mem, PDB, non-root
      securityContext, `readOnlyRootFilesystem: true`)
- [ ] Read `.github/workflows/ci.yml` in full, especially the `build` job matrix (~lines 125-182)
      and `security-scan`/Trivy job (~lines 236-274) and the `deploy-staging` job (~lines 337-344,
      currently fully commented out)
- [ ] Read `.gitlab-ci.yml` at repo root — confirm whether this is genuinely used or dead, and
      whether `.github/workflows/gitlab-sync.yml` mirrors to it
- [ ] Read `apps/api-gateway/src/main.ts` (currently `export {}`) and `apps/api-gateway/package.json`
      (already lists `@fastify/http-proxy`, `@fastify/rate-limit`, `@fastify/helmet`,
      `@fastify/cors` as dependencies — unused)
- [ ] Read `infrastructure/k8s/network-policy.yaml:30-54` — the `api-gateway` pod-selector reference
      that currently matches nothing
- [ ] Read `infrastructure/docker/prometheus/prometheus.yml` in full
- [ ] Read `infrastructure/docker/postgres/init.sql` — confirm `statement_timeout` is absent
- [ ] Read `ERP-PLANNING/phase-completions/chaos-engineering-report.md` (the `statement_timeout`
      claim) and `dr-drill-report.md` (the manual backup steps that need automating)
- [ ] Check `infrastructure/helm/` and `infrastructure/terraform/` — confirm they're empty
      (`.gitkeep` only)
- [ ] List every service under `apps/` and cross-reference against which have a `Dockerfile` today —
      build your worklist from this, don't trust the CI matrix's list blindly since it may already
      be wrong in both directions
- [ ] Confirm local Docker Compose stack is runnable (`docker compose up -d`) — you'll use it to
      test each new Dockerfile as you go

---

## ═══════════════════════════════════════════
## PROJECT CONTEXT
## ═══════════════════════════════════════════

### Scope decision you must make explicitly for api-gateway
Two legitimate paths — pick one and say so clearly in your completion report, don't leave it
ambiguous:
- **(a) Build it.** Implement a real reverse proxy using the already-installed
  `@fastify/http-proxy` + JWT validation + `@fastify/rate-limit` + `@fastify/helmet`/`cors`,
  routing to each backend service. This is the larger option but resolves H2 completely and gives
  the platform a real edge security perimeter.
- **(b) Descope it honestly.** Remove `api-gateway` from the CI build matrix and the K8s
  NetworkPolicy reference until a future phase builds it; document clearly in
  `ERP-PLANNING/TECH_AUDIT.md` and the master spec that services are currently reached directly,
  each independently enforcing its own auth (which ES-21 hardened).

Given this phase's already-large scope (13 Dockerfiles + 14 K8s manifests), **default to (b)** for
this phase and file api-gateway construction as a follow-up phase (e.g. propose "ES-28 — API
Gateway Implementation" in your completion report's Known Issues) — unless you have significant
extra time budget, in which case (a) is more valuable long-term. Either way, do not leave the
current false middle ground (stub code + infra that assumes it's real) in place.

### Coding Standards for Dockerfiles
Match `auth-service/Dockerfile`'s pattern exactly: multi-stage build (deps → build → runtime),
non-root user, `HEALTHCHECK` hitting the service's `/health` endpoint, minimal final image (don't
ship devDependencies or source maps to the runtime stage unless needed for error tracing — check
what auth-service's does and be consistent).

---

## ═══════════════════════════════════════════
## OBJECTIVE
## ═══════════════════════════════════════════

1. **[C11]** Author Dockerfiles for the 12 services missing one; fix the CI build matrix to match
2. **[H2]** Explicitly resolve the api-gateway ambiguity (build or honest-descope — see above)
3. **[H5]** Templatize Kubernetes manifests for the 14 services that have none
4. **[H6]** Actually apply the `statement_timeout` Postgres fix the chaos report claims exists
5. **[M12]** Add the 3 missing Prometheus scrape jobs
6. **[M13]** Add an automated backup job/CronJob
7. **[L5]** Resolve the dual CI-system ambiguity (GitHub Actions vs GitLab CI)
8. **[L6]** No action needed beyond confirming Istio scaffolding is intentionally minimal — document
   as-is

---

## ═══════════════════════════════════════════
## SCOPE
## ═══════════════════════════════════════════

### Step 1 — Author missing Dockerfiles [C11]

For each of the ~12 services in the CI matrix without a `Dockerfile` (confirm the exact current
list from your pre-flight check — the audit found these specifically referenced in the CI matrix:
api-gateway, sales-service, inventory-service, accounting-service, purchase-service, hr-service,
gst-service, notification-service, scheduler-service, search-service, report-service,
tenant-service — plus any `apps/*` not in that list at all that should be, e.g. event-service,
production-service, pos-frontend/web-frontend if they're meant to ship as containers too, check
`docker-compose.yml` for which services already run containerized locally as the source of truth):

Create `apps/<service>/Dockerfile` per the auth-service template, adjusted per service for:
- Correct build context / workspace package name
- Correct exposed port (check each service's `main.ts`/config for its listen port)
- Correct `/health` endpoint path if it differs from auth-service's
- `report-service` specifically needs Puppeteer/Chromium — check if a different base image or
  additional system dependencies are required (Puppeteer typically needs extra apt packages in a
  Debian-based image, or use `puppeteer`'s recommended Docker setup) — do not assume the auth-service
  template's base image has what Puppeteer needs without checking

Test each Dockerfile builds and the resulting container passes its healthcheck locally
(`docker build` + `docker run` + `curl localhost:<port>/health`) before moving to the next.

If api-gateway is being descoped (Step 2 decision (b)), skip its Dockerfile and remove it from the
CI matrix instead (see Step 5).

### Step 2 — api-gateway decision [H2]

Implement per whichever option (a)/(b) you chose in Project Context. If (b): update
`infrastructure/k8s/network-policy.yaml:30-54` to remove the dead `api-gateway` podSelector
reference (or comment it out with a clear `# TODO: re-add when api-gateway is implemented, see
ES-28` note), and remove the `host.docker.internal:3000` api-gateway scrape target from
`infrastructure/docker/prometheus/prometheus.yml`.

### Step 3 — Kubernetes manifests for remaining services [H5]

For each service now getting a Dockerfile (Step 1), create `infrastructure/k8s/<service>.yaml`
using `auth-service.yaml` as the template: resource requests/limits sized reasonably for that
service's expected load (auth-service's `100m/128Mi request, 500m/512Mi limit` is a reasonable
default for most; report-service likely needs more memory for Chromium — check Puppeteer's
documented memory recommendations), liveness/readiness probes against `/health`, an HPA (2-10
replicas, 70% CPU / 80% mem targets, matching auth-service unless a specific service's profile
suggests otherwise), a PodDisruptionBudget, and the same non-root/`readOnlyRootFilesystem`
securityContext.

Given the volume here, consider whether to also start an `infrastructure/helm/` chart that
templates this pattern with per-service `values.yaml` overrides (the directory already exists,
empty, ready for this) — this is explicitly optional for this phase (raw manifests are an
acceptable deliverable) but flag your choice and reasoning in the completion report; if you have
time budget, a Helm chart is more valuable long-term than 14 near-duplicate YAML files.

### Step 4 — Apply the documented Postgres fix [H6]

Add to `infrastructure/docker/postgres/init.sql` (or wherever the local stack's Postgres config is
initialized — confirmed from pre-flight): `ALTER SYSTEM SET statement_timeout = '3000';` followed
by `SELECT pg_reload_conf();`, matching exactly what `dr-drill-report.md:189` already claims is
applied. For the Kubernetes/production path, add the equivalent as a Postgres ConfigMap or
init-container step under `infrastructure/k8s/` if a production Postgres manifest exists or is
being added as part of this phase's HA-database work (check `chaos-engineering-report.md`
Experiment 2.1's note about needing Patroni/pg_auto_failover in production — that's out of scope
here, just the `statement_timeout` setting itself is in scope).

### Step 5 — Prometheus + CI matrix corrections [M12, L5]

`infrastructure/docker/prometheus/prometheus.yml`: add scrape jobs for `hr-service`,
`purchase-service`, `production-service` (confirmed to already expose `/metrics` per the audit —
this is purely a missing config entry, not a code change), matching the existing job format for
the other 12 services.

`.github/workflows/ci.yml`: update the `build` and `security-scan` matrices to exactly match the
services that now have Dockerfiles (adding the 12 you built, removing api-gateway if descoped per
Step 2's option (b)).

Resolve the GitHub Actions vs `.gitlab-ci.yml` ambiguity: confirm with existing evidence (which one
actually runs on PRs — check repo settings/branch protection if you have access, or ask the team)
which is authoritative. If `.gitlab-ci.yml` is genuinely dead (only exists because
`gitlab-sync.yml` mirrors the repo to GitLab, not because GitLab CI actually runs), delete it and
say so in the completion report. If both genuinely run, document why and ensure they don't diverge
in what they check.

### Step 6 — Automated backup [M13]

Add a scheduled backup mechanism matching the manual steps `dr-drill-report.md` already validated
work correctly (`pg_dump -Fc`, Redis `SAVE`, MinIO mirror). For the local/Docker Compose
environment, add a simple cron-based sidecar container or a `docker-compose.yml` profile running a
backup script on a schedule, uploading to a `backups/` volume (or MinIO itself, in a separate
bucket). For the Kubernetes path, add a `CronJob` manifest under `infrastructure/k8s/` running the
same backup logic against the production database, writing to S3/MinIO. Keep the script itself
simple and close to what the DR drill already used — this phase is about scheduling/automating the
already-proven-correct manual steps, not inventing a new backup strategy.

### Step 7 — Istio scaffolding [L6]

No code change required. Add one paragraph to `ERP-PLANNING/TECH_AUDIT.md`'s §23b (Kubernetes &
Service Mesh section) confirming Istio remains intentionally scaffolding-only at this stage, so a
future session doesn't mistake the 2 policy files for a working service mesh.

### OUT OF SCOPE
- Actually deploying to a real Kubernetes cluster (this phase produces correct manifests; applying
  them to a live cluster is an operational step outside a Claude Code session)
- Terraform IaC (still `.gitkeep`-only; out of scope unless explicitly requested in a future phase)
- Building the full api-gateway if you chose option (b) in Step 2

---

## ═══════════════════════════════════════════
## TESTING REQUIREMENTS
## ═══════════════════════════════════════════

1. Every new Dockerfile builds successfully (`docker build -t test-<service> apps/<service>`)
2. Every new container starts and its `/health` endpoint returns 200 within a reasonable startup
   window (match the DR drill's ~1-2 minute observed startup times as a sanity check)
3. CI's `build` job matrix runs green for every service now listed (verify via a CI run, not just
   local reasoning)
4. `kubectl apply --dry-run=client -f infrastructure/k8s/<new-service>.yaml` (or equivalent
   client-side validation without a live cluster) succeeds for every new manifest
5. Postgres started fresh from `init.sql` reports `statement_timeout = 3000` via
   `SHOW statement_timeout;`
6. Prometheus config validates (`promtool check config prometheus.yml` if available, or Prometheus
   container starts cleanly with the updated config and the 3 new targets show as UP)
7. Backup script/CronJob runs successfully against the local stack and produces a restorable
   dump (spot check: restore into a scratch DB and confirm row counts match, similar to the DR
   drill's validation)

---

## ═══════════════════════════════════════════
## BUILD VERIFICATION
## ═══════════════════════════════════════════

```bash
docker compose build            # confirm every service still builds via compose too
docker compose up -d
# curl each service's /health
pnpm build
pnpm lint
```

---

## ═══════════════════════════════════════════
## VERIFICATION CHECKLIST
## ═══════════════════════════════════════════

- [ ] Every backend service (minus api-gateway if descoped) has a working Dockerfile
- [ ] CI build matrix matches reality exactly — no phantom entries, no missing entries
- [ ] api-gateway's status is unambiguous — either functional or clearly and consistently descoped
      across code, K8s manifests, and Prometheus config
- [ ] Every backend service has a Kubernetes manifest with resource limits, probes, and HPA
- [ ] `statement_timeout = 3000` is set by `init.sql` and verified via `SHOW`
- [ ] Prometheus scrapes all 15 (or however many remain after api-gateway decision) services
      correctly, no dead targets
- [ ] An automated backup mechanism exists and has been proven to produce a restorable dump
- [ ] Dual-CI-system question is resolved (one deleted, or both justified)

---

## ═══════════════════════════════════════════
## REGRESSION CHECKLIST
## ═══════════════════════════════════════════

- [ ] auth-service's existing Dockerfile and K8s manifest are unchanged (they're the template, not
      the target)
- [ ] Local `docker compose up` developer workflow still works exactly as before for anyone not
      touching the new Dockerfiles
- [ ] Existing CI jobs (lint, type-check, test, TruffleHog/Snyk/Semgrep) that were already working
      are unaffected by matrix changes to the build/security-scan jobs
- [ ] `statement_timeout = 3000` doesn't break any legitimately-long-running query — spot check
      report generation (Puppeteer PDF gen) and any batch/import jobs against the new timeout

---

## ═══════════════════════════════════════════
## DEFINITION OF DONE
## ═══════════════════════════════════════════

- [ ] C11, H2, H5, H6, M12, M13, L5, L6 all closed per the fixes/decisions above
- [ ] CI is green on a real PR/push with the updated matrix
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/ES-27_COMPLETION.md`, explicitly
      recording the api-gateway build-vs-descope decision and the Helm-vs-raw-manifests decision
- [ ] `ERP-PLANNING/ARCHITECTURE_AUDIT_REPORT.md` updated: mark C11, H2, H5, H6, M12, M13, L5, L6
      with current status and a pointer to the completion report
- [ ] Update the production-readiness gate in `ARCHITECTURE_AUDIT_REPORT.md` §10 — most of its
      CI/K8s-related blockers should now be closeable

---

## ═══════════════════════════════════════════
## COMPLETION REPORT TEMPLATE
## ═══════════════════════════════════════════

**Save as:** `ERP-PLANNING/phase-completions/ES-27_COMPLETION.md`

```markdown
# ES-27 Completion Report — CI/CD, Docker & Kubernetes Deployability
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE

## Findings Closed
| ID | Finding | Fix Summary | Verified By |
|---|---|---|---|
| C11 | Dockerfiles missing for 12/13 services | Authored N Dockerfiles | docker build + health check |
| H2 | api-gateway stub referenced as live | [BUILT / DESCOPED — explain] | - |
| H5 | K8s manifests for 1/15 services | Authored N manifests [+ Helm chart if built] | dry-run validation |
| H6 | statement_timeout never applied | Added to init.sql | SHOW statement_timeout |
| M12 | 3 missing Prometheus scrape jobs | Added | Prometheus targets UP |
| M13 | No automated backup | [CronJob / compose profile] added | restore test |
| L5 | Dual CI systems | [deleted gitlab-ci.yml / justified both] | - |
| L6 | Istio scaffolding-only | Documented in TECH_AUDIT.md | - |

## Services Now Deployable (Dockerfile + K8s manifest)
[List]

## api-gateway Decision
[Explain: built or descoped, and why]

## Files Changed
[Table]

## Backup/Restore Verification
[Describe the restore test you ran]

## Known Issues / Deferred
[e.g. if api-gateway was descoped, propose "ES-28 — API Gateway Implementation" as follow-up]
```
