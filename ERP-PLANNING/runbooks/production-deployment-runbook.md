# Production Deployment Runbook & Rollback Procedure

> Implements PG-057 (`ERP-PLANNING/production-gap-prompts/016-Deployment/55-production-deployment-runbook-rollback.md`).
> Companion doc for a DB/infra incident specifically: `infrastructure/runbooks/dr-runbook.md`
> (full-restore-from-backup procedure, shipped by PG-024). This runbook covers the routine
> "ship a new release" path and its rollback; it defers to `dr-runbook.md` for the one rollback
> branch that needs a full restore (see §4).

**Status as of 2026-07-11 — read this before following any step below:**

| Prerequisite the gap-prompt assumed     | Actual state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PG-021 (real staging deploy)            | **Done.** `.github/workflows/ci.yml`'s `deploy-staging` job (real `kubectl apply -k`, per-tier rollout gate, smoke test, auto-rollback) is live, gated on `refs/tags/v*`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PG-022 (K8s production readiness)       | **Session 1 only.** `infrastructure/helm/erp/` exists (Deployment/Service/HPA/PDB/ServiceAccount templated for all 14 services) but CI still deploys via the original `infrastructure/k8s/*.yaml` + Kustomize, not this chart — see chart's own README "Known gaps". Ingress, full NetworkPolicy, and the Istio install-or-descope decision are still open (Session 2/3).                                                                                                                                                                                                                                                                                  |
| A production environment/cluster/CI job | **Does not exist.** There is only `deploy-staging`, one `KUBECONFIG_STAGING` secret, and one namespace (`erp-system`) — confirmed via `infrastructure/k8s/kustomization.yaml`'s own comment ("no separate `erp-staging` namespace... deploy into the existing `erp-system` namespace") and the Helm chart's `values-production.yaml` (`namespace: erp-system`, same name). **Environment separation in this repo is by cluster/kubeconfig, not by namespace name.** A real production deploy requires a second cluster (or at minimum a second kubeconfig/context pointed at production infrastructure) before any command below is more than a rehearsal. |
| Frontend deploy step                    | **No mechanism exists.** `web-frontend`/`pos-frontend` have no `Dockerfile`, no build-and-publish CI job, and no hosting target anywhere in this repo — CI only runs their unit tests and Playwright e2e suites. §2 documents this as an explicit gap, not a working step.                                                                                                                                                                                                                                                                                                                                                                                 |

If any of the above hasn't changed since you're reading this, treat every `kubectl`/`helm` command in this runbook as **written for a cluster you must provision yourself** — dry-run each step against staging (`erp-system` on the existing cluster) first, per the Testing requirement in the gap-prompt.

---

## 1. Pre-deploy checklist

Run all of these before triggering a production deploy. Stop and escalate if any fails.

1. **CI is green on the tag being deployed.** Confirm all current jobs passed for that tag/SHA: `lint`, `type-check`, `test`, `e2e`, `build` (×15: 14 services + `api-gateway`), `dependency-audit`, `sast`, `security-scan` (×14), `secrets-scan`, `snyk-scan`, `load-test`. (`api-gateway` is scanned/built but not deployed anywhere in `infrastructure/k8s/` — it's a stub, not a real gap in this checklist.)

2. **Scan for pending manual deployment steps:**

   ```bash
   bash scripts/check-pending-deployment-checklists.sh
   ```

   This greps every `ERP-PLANNING/phase-completions/*.md` for an unchecked `- [ ] ...` line under a `## Deployment Checklist` heading — the same scan `CLAUDE.md` mandates at AI-session start, now a pre-deploy gate. As of this writing it finds real, still-open items in 16 completion reports (ES-20, ES-35, ES-36, ES-37, GLOBAL-SEARCH, PG-005, PG-024, PG-025, PG-026, PG-044, PG-045, PG-050, PG-051, PG-052, PG-053, PG-055) — most are "no live environment existed yet to run this against," which stops being true the moment a real production cluster exists. **Do not proceed past this step until a human has gone through the script's output and either confirmed each item is done against the target environment, or explicitly accepted the ones that are genuinely not blocking (e.g. PG-050/051's shared `WAREHOUSE_VIEW` follow-up).**

3. **Trigger an out-of-cycle backup** immediately before the deploy window, so §4's rollback path has a restore point newer than the last scheduled run:

   ```bash
   kubectl create job --from=cronjob/erp-backup manual-predeploy-backup -n erp-system
   kubectl wait --for=condition=complete job/manual-predeploy-backup -n erp-system --timeout=600s
   ```

   (mirrors `infrastructure/k8s/backup-cronjob.yaml` / `infrastructure/docker/backup/backup.sh` — do not write a new backup mechanism.)

4. **Review every migration new since the last production deploy.** As of this writing the full set is `0000`–`0048` in `packages/db-client/migrations/` (latest: `0048_pg032_warehouse_valuation.sql`) — since no production deploy has happened yet, the _first_ production deploy applies all of them, not an incremental set. For every migration after that, diff `packages/db-client/migrations/` against the last-deployed tag and classify each new file as additive or breaking (see §4 for the decision rule and real examples from this repo's history). Do not proceed if a breaking migration exists without a hand-authored compensating migration already prepared.

5. **Confirm production credentials are least-privilege and environment-scoped** — a `KUBECONFIG_PRODUCTION`-equivalent secret scoped to only the `erp-system` namespace on the production cluster (RBAC `Role`, not `ClusterRole`), never cluster-admin. Matches the standard already set for `KUBECONFIG_STAGING` in `ci.yml`.

## 2. Deploy sequence (order matters)

1. **Apply migrations first**, before any service restart — every service assumes its schema already exists at boot.

   ```bash
   DATABASE_URL="$PRODUCTION_DATABASE_URL" pnpm --filter @erp/db db:migrate
   ```

   (`drizzle-kit migrate`, run once against production Postgres — not per-service.)

2. **Deploy backend services in dependency order.** All 14 live in one `kubectl apply -k infrastructure/k8s/` (or, once CI adopts it, `helm upgrade --install erp infrastructure/helm/erp/ -f infrastructure/helm/erp/values-production.yaml --set global.imageTag=<version>`) — apply once, then gate the _rollout_ in tiers:
   - **Tier 1:** `auth-service`, `tenant-service` — every other service's `preHandler` depends on these being reachable.
   - **Tier 2:** `event-service` — outbox/Kafka relay backbone.
   - **Tier 3 (parallel, no inter-ordering):** `sales-service`, `purchase-service`, `inventory-service`, `accounting-service`, `gst-service`, `hr-service`, `production-service`, `notification-service`, `report-service`, `search-service`, `scheduler-service`.

   ```bash
   sed -i "s/newTag: latest/newTag: ${VERSION}/" infrastructure/k8s/kustomization.yaml
   kubectl apply -k infrastructure/k8s/

   for svc in auth-service tenant-service; do
     kubectl rollout status "deployment/${svc}" -n erp-system --timeout=180s
   done
   kubectl rollout status deployment/event-service -n erp-system --timeout=180s

   TIER3=(sales-service purchase-service inventory-service accounting-service gst-service \
          hr-service production-service notification-service report-service search-service scheduler-service)
   pids=()
   for svc in "${TIER3[@]}"; do
     kubectl rollout status "deployment/${svc}" -n erp-system --timeout=180s & pids+=($!)
   done
   for pid in "${pids[@]}"; do wait "$pid"; done
   ```

   Do not proceed to the next tier (or to §3) until the current tier's rollouts report healthy — this mirrors `deploy-staging`'s own "Wait for rollouts" step, just tiered instead of all-at-once (staging currently rolls all 14 out together since it has no dependency-tier gate yet; production should not skip this until CI is updated to match).

3. **Frontends deploy last — currently a gap, not a step.** `web-frontend`/`pos-frontend` have no Docker image, no CI build/publish job, and no hosting target defined anywhere in this repo. Before this runbook's "deploy frontends last" instruction is anything more than a placeholder, one of the following must exist: a static-hosting target (e.g. an S3+CloudFront or Vercel/Netlify deploy step) plus a CI job that builds `pnpm --filter @erp/web-frontend build` / `pnpm --filter @erp/pos-frontend build` and publishes the output. Until then, treat any frontend release as a manual, undocumented action outside this runbook's scope — flag this gap rather than improvise a hosting mechanism during a live deploy.

## 3. Smoke-test gate

No Ingress exists anywhere in `infrastructure/k8s/` (confirmed — `staging-smoke-test.sh`'s own comment), so the gate checks each Service's ClusterIP from inside the cluster, not a public URL:

```bash
bash scripts/ci/staging-smoke-test.sh erp-system
```

All 14 backend services must return `{"status":"healthy"}`. This is the exact script `deploy-staging` already runs — reuse it verbatim against the production namespace, don't write a second one.

If a full-stack E2E suite covering a real business workflow (e.g. PG-054's work) is available at deploy time, additionally create-and-confirm one throwaway invoice in a dedicated smoke-test tenant — never a real customer tenant — as a deeper go/no-go signal than health checks alone.

**Go/no-go:** proceed only if the smoke test passes. If it fails, go straight to §4.

## 4. Rollback procedure

**Application-only rollback (default path — attempt this first, always):**

```bash
for svc in auth-service tenant-service event-service sales-service purchase-service \
           inventory-service accounting-service gst-service hr-service production-service \
           notification-service report-service search-service scheduler-service; do
  kubectl rollout undo "deployment/${svc}" -n erp-system
done
```

This is fast (seconds-to-minutes) and is sufficient for the large majority of releases, matching this repo's own standing rule that migrations should be additive. It's also exactly what `deploy-staging`'s own `Rollback on failure` step already does automatically on a rollout or smoke-test failure — production should do the same, just manually triggered on an operator's decision rather than only on CI failure.

**Migration-involved rollback — decided _before_ the deploy, not improvised during an incident:**

Since this repo's Drizzle migrations are forward-only (`packages/db-client/migrations/*.sql`, no generated `down.sql`), classify every new migration ahead of time:

- **Additive (safe — application-only rollback is enough).** Real example from this repo:
  [`0033_settings_updated_by.sql`](../../packages/db-client/migrations/0033_settings_updated_by.sql) —
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS "updated_by" integer` on three tables. The previous
  application code simply never reads/writes that column; leaving the schema ahead of a rolled-back
  deploy is harmless.
- **Breaking (needs a hand-authored compensating migration, prepared _before_ the risky deploy).**
  Real example from this repo:
  [`0010_es06_hr_encryption_holidays.sql`](../../packages/db-client/migrations/0010_es06_hr_encryption_holidays.sql) —
  `ALTER COLUMN "gross_salary" TYPE text`, changing a numeric column's type in place. Old application
  code reading/writing it as a number would break immediately. This is precisely why `ES-06_COMPLETION.md`'s
  own Deployment Checklist required a manual data-migration script (`migrate-payslip-encryption.ts`)
  run before the updated `hr-service` was deployed — the exact "manual DB/data migration not applied
  by code deploy alone" scenario `CLAUDE.md` was written around. If a future migration is this shape,
  a numbered compensating migration (`NNNN_rollback_<name>.sql`) must exist and be verified _before_
  the risky migration ships, not written reactively mid-incident.
- **If neither an application-only rollback nor a prepared compensating migration is viable** (i.e. the
  deploy is already in trouble and no rollback path was pre-arranged): fall back to the full restore
  procedure in `infrastructure/runbooks/dr-runbook.md`, using the pre-deploy backup from §1 step 3 as
  the restore point. This accepts the RPO loss (data written between that backup and the incident) as
  the cost of this path — it is the exception, not the default rollback story.

**Decision rule:** always attempt application-only rollback first. A full DB restore is reserved for the rare structurally-breaking migration with no prepared compensating migration — not a routine fallback.

---

## Appendix: acceptance-criteria cross-references

- Pending-checklist scan verified against real data: `scripts/check-pending-deployment-checklists.sh` found genuine unchecked items in 16 existing completion reports on first run (see §1 step 2) — not a synthetic test.
- Deploy-sequence dry run, application-only rollback dry run: **not yet performed.** No production (or even a second, production-shaped) cluster exists to dry-run against as of this writing. Do not treat this runbook as incident-tested until that dry run happens — see the Status table at the top.
- Migration rollback decision rule: documented above with one real additive (`0033`) and one real breaking (`0010`) example from this repo's actual migration history.
- Stale `infrastructure/runbooks/dr-runbook.md` reference: already resolved — PG-024 (2026-07-10) created that file. This runbook cross-links to it (top of file, §4) rather than duplicating its restore procedure.
