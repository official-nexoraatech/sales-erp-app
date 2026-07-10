# [PG-057] Production Deployment Runbook & Rollback Strategy

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Deployment
**Priority:** High
**Complexity:** M — no new code paths, but a real, tested runbook covering 14 services + 2 frontends with a correct dependency-ordered deploy sequence and a concrete rollback procedure.
**Depends on:** PG-021 (CI staging-deploy real implementation), PG-022 (Kubernetes production readiness)
**Blocks:** none
**Primary service(s)/package(s):** new `ERP-PLANNING/runbooks/` (or `infrastructure/runbooks/`) doc, `.github/workflows/ci.yml`, `infrastructure/k8s/*.yaml`, `packages/db-client/migrations`

---

## Overview

- **Business objective:** No production deployment runbook or rollback procedure exists anywhere in this repository today (verified — see Existing Code Analysis). Every deploy would currently be an undocumented, tribal-knowledge action, and there is no defined path back to a known-good state if a release breaks production. This repo's own `CLAUDE.md` already mandates, at the *session* level, checking `ERP-PLANNING/phase-completions/` for unchecked `Deployment Checklist` items before any AI coding session starts — that discipline exists because past phases (ES-06 payroll, for example) required manual DB/data migrations that are not applied by a normal code deploy, and skipping them causes data corruption or runtime errors. This package formalizes that exact same discipline at the *infrastructure* level: a human running a real production deploy needs the same "are there pending manual steps?" gate CLAUDE.md already enforces for AI sessions, expressed as an actual runbook step, not just a session-start habit.
- **Current implementation:** Nothing. Confirmed via search: no file named `*runbook*` exists under `ERP-PLANNING/` or `infrastructure/` (the only two runbook-shaped hits are `ERP-PLANNING/audit-phase-prompts/ES-27-CICD-DOCKER-KUBERNETES-DEPLOYABILITY.md`, an audit *prompt* not a runbook, and this package's own placeholder path). Notably, `ERP-PLANNING/phase-completions/dr-drill-report.md` (2026-07-01) recommends in its "Recommendations for Production" section: *"DR runbook: Full step-by-step procedure documented in `infrastructure/runbooks/dr-runbook.md`"* — but that file **does not exist** (verified — `infrastructure/` has no `runbooks/` subdirectory at all). This is a stale, aspirational forward-reference in an otherwise-accurate report; it should not be treated as evidence a runbook already exists, and this package's runbook should absorb/supersede that reference (either by building the DR-specific runbook this package's structure calls for as an appendix, or explicitly cross-linking to a future dedicated DR-runbook file — not by re-creating a second, inconsistent runbook).
- **Current architecture:** `.github/workflows/ci.yml`'s `deploy-staging` job (lines 382-408) is the only deploy-adjacent automation in the repo, and it is presently a no-op stub (every `kubectl`/`helm` line commented out) — this is exactly what **PG-021** fixes. `infrastructure/k8s/*.yaml` already has real per-service manifests for all 14 backend services (Deployment + Service + HPA + PDB + ServiceAccount each) — but no Helm chart, no versioned release mechanism, and (per PG-021's own findings) a registry mismatch between what CI publishes (Docker Hub, `nexoraatech/erp-<service>`) and what the manifests pull (`ghcr.io/nexoraatech/erp/<service>:latest`). **This runbook cannot be written as if PG-021/PG-022 are already done** — it must be written *for* the post-PG-021/PG-022 world (real `kubectl apply -k` or Helm-based deploy, correct registry, rollout-status gate, smoke test), which is why this package explicitly depends on both.
- **Current limitations:** No documented pre-deploy checklist. No documented deploy sequence or ordering rationale (migrations-before-restart is implicit in how Drizzle/Fastify services boot, but nowhere written down). No documented rollback procedure — neither for a bad application deploy (image rollback) nor for a bad migration (this repo's migrations, via `drizzle-kit`, are forward-only `.sql` files under `packages/db-client/migrations/` with no generated `down` migration — verified via `Glob`, only numbered `NNNN_*.sql` files and a `meta/` snapshot/journal directory exist, no `*_down.sql` or reverse-migration tooling). No smoke-test gate is documented as a go/no-go checkpoint (PG-021 builds the mechanism; this runbook documents when/how a human uses it).

## Existing Code Analysis

- **What already exists and should be reused:**
  - `infrastructure/docker/backup/backup.sh` — a real, working backup script (pg_dump `-Fc` custom format, `redis-cli SAVE`, MinIO mirror, 7-day retention) plus `infrastructure/k8s/backup-cronjob.yaml` scheduling it. Reuse this exact backup as the "pre-deploy safety snapshot" step — do not write a new backup mechanism for this runbook; just document *when* to trigger an out-of-cycle run of the existing one (immediately before any production deploy that includes a migration).
  - `ERP-PLANNING/phase-completions/dr-drill-report.md` — already proves a full restore-from-backup path works (RTO 24m17s, RPO 2m16s) and documents exact restore commands (`pg_restore -Fc --clean --if-exists`, Redis RDB copy, MinIO mirror) — this is the concrete "how do I roll back the database if the runbook's rollback step is ever actually needed" procedure; reuse its restore commands verbatim rather than re-deriving them.
  - The CLAUDE.md session-start deployment-checklist-scan behavior — the runbook's pre-deploy checklist step should explicitly say "run the same scan CLAUDE.md already runs at AI-session start: grep `ERP-PLANNING/phase-completions/*.md` for unchecked `- [ ]` items under `## Deployment Checklist`" so the same discipline applies whether a human or an AI session is driving the deploy.
  - PG-021's planned smoke-test script (`scripts/ci/staging-smoke-test.sh`, curling all 14 `/health` endpoints) — reuse the same script as this runbook's go/no-go gate for production, not a separately invented production-only smoke check.
- **What should never be modified:** `infrastructure/docker/backup/backup.sh` and the DR-drill's proven restore sequence — this package documents when to invoke them, it does not change how they work.
- **Prior related work:** `chaos-engineering-report.md` and `dr-drill-report.md` (both 2026-07-01) are the two existing resilience exercises; this runbook's rollback section should cross-reference both rather than re-deriving their findings (e.g., the chaos report's Experiment 1.1 already proves saga compensation correctly leaves an in-flight invoice DRAFT if a service dies mid-deploy — useful evidence for why a mid-rollout failure during this runbook's deploy sequence is safe to roll back from).

## Architecture

- The runbook is a single Markdown document (not code) with the following required sections, each mapped to a concrete, checkable step:
  1. **Pre-deploy checklist:**
     - Confirm CI is green on the tag being deployed (all 11 existing jobs: lint, type-check, test, e2e, build×14, dependency-audit, sast, security-scan×14, secrets-scan, snyk-scan).
     - **Scan for pending manual migration/deployment steps**: grep every `ERP-PLANNING/phase-completions/*_COMPLETION.md` for an unchecked `- [ ] ...` line under a `## Deployment Checklist` heading — the exact same check CLAUDE.md already mandates at AI-session start, now formalized as an infra-level gate. If any are found, the deploy does not proceed until a human explicitly confirms each has been run against the target environment (mirrors CLAUDE.md's own "ask the user if they have been done" rule).
     - Trigger an out-of-cycle run of `infrastructure/docker/backup/backup.sh` (or its K8s CronJob equivalent) immediately before the deploy window, so the rollback path in step 4 always has a fresh restore point newer than "last night's scheduled backup."
     - Confirm which of `packages/db-client/migrations/*.sql` are new since the last production deploy (compare against the last-deployed tag's migration set) and read each new migration's SQL — since Drizzle here is forward-only with no generated down-migration, every new migration must be additive/backward-compatible (matches this repo's own Enterprise Architecture Guidance: "every migration must be additive/reversible") or the deploy must not proceed without a hand-written compensating migration ready.
  2. **Deploy sequence (order matters):**
     1. Apply new Drizzle migrations first, against production Postgres, before any service restart — every service's own startup path assumes the schema it queries already exists; deploying new application code before its migration would 500 on first request. Use the existing `db:migrate` script (`drizzle-kit migrate`, `packages/db-client/package.json`) run once against the production `DATABASE_URL`, not per-service.
     2. Deploy backend services in dependency order per the Master Roadmap's own dependency graph: `auth-service` and `tenant-service` first (every other service's `preHandler` depends on them being reachable), then `event-service` (outbox/Kafka relay backbone other services' async flows depend on), then the remaining 11 business services (`sales-service`, `purchase-service`, `inventory-service`, `accounting-service`, `gst-service`, `hr-service`, `production-service`, `notification-service`, `report-service`, `search-service`, `scheduler-service`) — these 11 have no strict inter-ordering requirement among themselves (per the roadmap: "Business-module gaps... are leaves"), so they can roll out in parallel or any order once auth/tenant/event are healthy.
     3. Use `kubectl rollout status deployment/<svc> -n erp-production --timeout=180s` (the same gate PG-021 builds for staging) per service before moving to the next dependency tier — do not proceed to tier N+1 until tier N's rollouts report healthy.
     4. Deploy `web-frontend`/`pos-frontend` static builds last (they call the now-updated backend APIs; deploying frontend before backend risks a version-mismatch window where the new frontend calls an old backend contract).
  3. **Smoke-test gate:** run the shared smoke-test script (PG-021's `scripts/ci/staging-smoke-test.sh`, pointed at the production base URL) — all 14 `/health` endpoints must return `200 {"status":"ok"}`. Additionally run one real business-workflow check per the new full-stack E2E suite (PG-054) if available at the time — e.g. create-and-confirm one throwaway invoice in a dedicated smoke-test tenant — as a deeper go/no-go signal than health checks alone.
  4. **Rollback procedure:**
     - **Application-only rollback** (no migration involved, or migration is confirmed backward-compatible): `kubectl rollout undo deployment/<svc> -n erp-production` per affected service, or re-apply the previous tag's image via the same Kustomize `images:` override mechanism PG-021 introduces — this is fast (seconds-to-minutes) and is the default path.
     - **Migration-involved rollback:** because Drizzle migrations here are forward-only with no generated `down.sql`, "rolling back a migration" means one of two things, decided *before* the deploy (not improvised during an incident): (a) the migration was additive-only (new nullable column, new table, new index) and the previous application code simply ignores the new schema — safe to roll back the application alone, leaving the schema ahead of the code, or (b) the migration was structurally breaking (column removed/renamed, `NOT NULL` added without a default) — in which case a hand-authored compensating migration (e.g. `0035_rollback_0034_xyz.sql`) must already exist and be ready *before* the risky migration is applied, following this same numbered-sequential convention (`packages/db-client/migrations/NNNN_*.sql`). If neither exists and the deploy is already in trouble, the last-resort path is the DR-drill's proven full restore procedure (`dr-drill-report.md` Step 2, `pg_restore -Fc --clean --if-exists` from the pre-deploy backup) accepting the RPO loss (data written between the pre-deploy backup and the incident) as the cost of that path.
     - **Decision rule:** application-only rollback is always attempted first and is sufficient for the large majority of releases (per this repo's own "every migration must be additive/reversible" standing rule) — a full DB restore is the exception path for the rare structurally-breaking migration, not the default rollback story.
- No new system component is introduced; this section only sequences existing pieces (`db:migrate`, `kubectl rollout`, `backup.sh`, the DR restore steps, PG-021's smoke script) into one documented, ordered procedure.

## Database Changes

- Not applicable as a schema change from *this* package itself — but this package's rollback section directly depends on and documents this repo's actual migration-rollback posture: **forward-only Drizzle migrations, no generated down-migrations.** Rollback strategy (restated from Architecture): additive migrations roll back via application-only rollback (schema stays ahead of reverted code, which is safe since additive changes don't break old code); breaking migrations require a hand-authored compensating forward migration prepared *before* the risky deploy, not written reactively during an incident; if neither is available, full restore-from-backup (per `dr-drill-report.md`'s proven procedure) is the fallback, accepting its RPO.

## Backend

Not applicable — no application code changes. This package is documentation plus a small amount of tooling glue (see Deliverables) that formalizes existing scripts into a sequenced procedure.

## Frontend

Not applicable — backend/infra-only gap, though the runbook explicitly documents frontend deploy ordering (last, after backend) since `web-frontend`/`pos-frontend` are static builds calling the now-current backend API contract.

## API Contract

Not applicable — no new endpoints. The runbook references existing endpoints only (`GET /health` on every service, per `registerHealthRoute`).

## Multi-Tenant Considerations

- The smoke-test gate's deeper business-workflow check (create-and-confirm a throwaway invoice) must run against a dedicated, clearly-marked smoke-test tenant, never a real customer tenant — same isolation discipline as every other test-data concern in this backlog (see PG-054, PG-055's own Multi-Tenant sections for the identical rule).

## Integration

- **`.github/workflows/ci.yml`** — this runbook assumes PG-021's completed `deploy-staging`-style job exists (or an equivalent `deploy-production` job gated similarly, likely on a stricter approval/environment-protection rule than staging) as the mechanical executor of the deploy sequence; this package does not itself add that CI job (that's PG-021/PG-022's scope) — it documents the human-facing procedure around triggering and monitoring it.
- **`infrastructure/k8s/*.yaml`, `infrastructure/docker/backup/`** — referenced directly by the runbook's deploy-sequence and rollback steps.
- **`packages/db-client/migrations`** — referenced by the pre-deploy migration-review step and the rollback decision rule.
- **`ERP-PLANNING/phase-completions/*_COMPLETION.md`** — the source the pre-deploy checklist step scans for unchecked `Deployment Checklist` items, mirroring CLAUDE.md's own session-start behavior.

## Coding Standards

- The runbook itself is Markdown, not code — but any small tooling glue this package adds (e.g., a `scripts/check-pending-deployment-checklists.sh` that automates the "grep phase-completions for unchecked items" step, so a human doesn't have to do it by hand every time) should follow this repo's existing shell-script conventions (`set -euo pipefail`, matching `infrastructure/docker/backup/backup.sh`'s own style) and `@erp/logger`-equivalent structured echo statements where applicable.

## Performance

Not applicable — no runtime performance implication; the only "performance" consideration is keeping the documented deploy sequence's total wall-clock time reasonable, which is inherited from PG-021's own per-service `rollout status --timeout=180s` budget.

## Security

- The pre-deploy checklist step must never expose production secrets while checking pending migrations/checklists — this is a read-only documentation/grep step, no credentials touched.
- Rollback procedures involving a full DB restore must follow the same secret-handling discipline already used by `backup.sh`/the DR-drill (credentials via environment variables, never printed to logs).
- The runbook should explicitly require least-privilege, environment-scoped credentials for whoever executes a production deploy (same principle PG-021 already calls out for `KUBECONFIG_STAGING` — this package's production equivalent must not be cluster-admin-scoped either).

## Testing

- No new automated test suite — the acceptance test for this package is a **dry-run walkthrough**: execute every runbook step against a staging (not production) environment end-to-end at least once, confirming each step's command actually works as written (e.g., the pending-checklist grep actually finds a deliberately-added unchecked item; the smoke-test gate actually fails when a service is deliberately left down; the rollback command actually reverts a deliberately-bad deploy) before trusting the runbook in a real production incident.

## Acceptance Criteria

- [ ] A single runbook document exists (e.g. `ERP-PLANNING/runbooks/production-deployment-runbook.md`) covering, in order: pre-deploy checklist, deploy sequence, smoke-test gate, rollback procedure — matching the structure described in Architecture.
- [ ] The pre-deploy checklist step is verified to actually catch an unchecked `Deployment Checklist` item when one is deliberately present in a test `*_COMPLETION.md` file.
- [ ] The documented deploy sequence is dry-run against a staging environment (post-PG-021) at least once, with each ordering step (migrations → auth/tenant → event-service → business services → frontends) confirmed correct.
- [ ] The rollback procedure's application-only path is dry-run at least once (deploy a deliberately broken image, confirm `kubectl rollout undo` restores the previous known-good version and the smoke gate goes green again).
- [ ] The migration-rollback decision rule (additive vs. breaking) is documented with a concrete example of each from this repo's actual migration history (e.g., point to a real additive migration like `0033_settings_updated_by.sql` as the "safe, app-rollback-only" example).
- [ ] The stale `infrastructure/runbooks/dr-runbook.md` reference in `dr-drill-report.md` is either resolved (that file created, scoped specifically to DR restores) or explicitly cross-linked from this new runbook so the two don't drift into duplicate/conflicting procedures.

## Deliverables

- **Files to create:** `ERP-PLANNING/runbooks/production-deployment-runbook.md` (the runbook itself); optionally `scripts/check-pending-deployment-checklists.sh` (automates the pre-deploy checklist scan).
- **Files to modify:** none required (this package does not need to modify `ci.yml`/`infrastructure/k8s` directly — it documents and sequences what PG-021/PG-022 build; if either lands slightly differently than assumed here, update this runbook's Deploy Sequence step accordingly).
- **Migrations:** none added by this package; the runbook documents the existing migration set's rollback posture.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** none automated; a documented staging dry-run walkthrough is the verification method (see Testing).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** No production deployment runbook or rollback strategy exists anywhere in the repo. The only deploy-adjacent CI job (`deploy-staging` in `ci.yml`) is currently a no-op stub — PG-021 is the package that makes it real, and PG-022 formalizes the Kubernetes manifests it deploys into a production-ready chart. A DR-drill report and a chaos-engineering report (both 2026-07-01) already prove the restore-from-backup path and several resilience properties work, and are useful source material for this runbook's rollback section — but neither is itself a deployment runbook. The DR-drill report references a `infrastructure/runbooks/dr-runbook.md` that was never actually created — a stale forward-reference, not evidence a runbook exists.

**Current Objective:** Write a real, concrete production deployment runbook: a pre-deploy checklist (including a formalized version of CLAUDE.md's own session-start "scan phase-completions for unchecked Deployment Checklist items" rule), a dependency-ordered deploy sequence across the 14 backend services + 2 frontends (migrations first, then auth/tenant, then event-service, then the remaining leaf services, then frontends last), a smoke-test gate, and a concrete rollback procedure (application-only rollback via `kubectl rollout undo` as the default path; a hand-prepared compensating migration or full DR-proven restore as the fallback for the rare structurally-breaking migration, since this repo's Drizzle migrations are forward-only with no generated down-migrations).

**Architecture Snapshot:**
1. This package explicitly depends on PG-021 (makes `deploy-staging` real) and PG-022 (K8s production readiness) — the runbook is written for the post-PG-021/022 world, not the current no-op-stub world; if either package hasn't landed yet, the runbook's deploy-sequence commands are aspirational and must be flagged as "requires PG-021/022 to be usable as written."
2. Migrations live in `packages/db-client/migrations/` as sequential `NNNN_*.sql` files (latest as of this writing: `0034_organization_theme_config.sql`) via `drizzle-kit migrate` — no down-migrations are auto-generated; rollback of a breaking migration requires a hand-authored compensating forward migration.
3. `infrastructure/docker/backup/backup.sh` (pg_dump `-Fc` + Redis SAVE + MinIO mirror, 7-day retention) and the DR-drill's proven restore commands are the existing, working backup/restore mechanism this runbook's rollback fallback reuses — do not invent a new one.
4. Service dependency order (per the Master Roadmap's dependency graph): `auth-service`/`tenant-service` first, `event-service` second (outbox/Kafka backbone), the remaining 11 business services are leaves with no strict inter-ordering, frontends deploy last.
5. CLAUDE.md already mandates scanning `ERP-PLANNING/phase-completions/*.md` for unchecked `Deployment Checklist` items at AI-session start — this runbook formalizes the identical check as a human-facing pre-deploy gate.

**Completed Components:** The backup script, the DR-drill's proven restore procedure, the chaos-engineering report's evidence that saga compensation/outbox durability hold under mid-deploy service failure — all reused as-is, not rebuilt.

**Pending Components:** PG-021 (real CI staging deploy) and PG-022 (K8s production readiness / Helm chart) — both prerequisites; this runbook's deploy-sequence steps reference their expected mechanics but do not implement them.

**Known Constraints:** No live production (or even staging, if PG-021/022 haven't landed) cluster may be available to dry-run this runbook against in a given session — if so, write the runbook and explicitly flag "requires a staging dry-run before this is trusted for a real incident," don't claim it's been tested without one.

**Coding Standards:** The runbook is Markdown; any small tooling glue (e.g. the pending-checklist-scan script) follows this repo's existing shell conventions (`set -euo pipefail`, matching `backup.sh`'s style).

**Reusable Components:** `infrastructure/docker/backup/backup.sh`; the DR-drill's restore commands; PG-021's planned smoke-test script (`scripts/ci/staging-smoke-test.sh`); `db:migrate` script in `packages/db-client/package.json`.

**APIs Already Available:** `GET /health` on every service (`registerHealthRoute`, `@erp/sdk`) — the smoke-gate's primary check.

**Events Already Available:** Not directly relevant — this is a deploy-process package, not an event-driven feature.

**Shared Utilities:** `@erp/logger`-equivalent structured output conventions for any new shell tooling.

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** any business-workflow smoke check (e.g. throwaway invoice creation) must run against a dedicated smoke-test tenant, never a real customer tenant.

**Security Rules:** production deploy credentials must be least-privilege and environment-scoped, matching the same standard PG-021 sets for `KUBECONFIG_STAGING`.

**Database State:** depends on the full migration set up through whatever is latest at deploy time; the runbook's pre-deploy step requires reviewing every migration new since the last production deploy for additive-vs-breaking classification.

**Testing Status:** zero runbook dry-runs have occurred yet (none can occur meaningfully until PG-021/022 land); this package's own acceptance criteria require at least one staging dry-run before being considered verified.

**Next Session Plan:** Single session to draft the runbook document itself (can be written now, referencing PG-021/022 as prerequisites for actual execution). A follow-up session (after PG-021/022 land) should perform the staging dry-run and update the runbook with any corrections found during that walkthrough.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/016-Deployment/55-production-deployment-runbook-rollback.md` and implement PG-057: write `ERP-PLANNING/runbooks/production-deployment-runbook.md` per this file's Architecture section. Check first whether PG-021 and PG-022 have landed (re-verify `ci.yml`'s `deploy-staging` job body and whether `infrastructure/helm/` still contains only a `.gitkeep`) — if not, write the runbook against their *planned* shape and flag every deploy-sequence step that assumes their completion, rather than guessing at different mechanics."
