# [PG-023] Alerting on Existing Prometheus Metrics

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** Infrastructure
**Priority:** High
**Complexity:** M — the hard, valuable part (alert rules against real metrics) is already written; the remaining work is deploying Alertmanager and wiring real notification channels, plus closing a few metric-coverage gaps.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** `infrastructure/docker/prometheus/`, `docker-compose.yml`, `packages/logger/src/erp-metrics.ts`, `infrastructure/k8s/`

---

## Overview

- **Business objective:** Metrics that are collected but never alert on anything are only useful if a human happens to be looking at a Grafana dashboard at the right moment. Negative stock, a growing DLQ, stalled sagas, or an auth brute-force spike are all things that should page or Slack someone within minutes, not be discovered days later during a manual dashboard review.
- **Current implementation — IMPORTANT CORRECTION to this package's originating brief:** The brief assumed "there is no Alertmanager / alerting-rule layer found in the provisioned stack." The **alerting-rule layer already exists and is substantial** — `infrastructure/docker/prometheus/alert-rules.yml` defines 13 real alert rules across 5 groups (`erp.api.errors`, `erp.kafka.dlq`, `erp.database`, `erp.sagas`, `erp.business`, `erp.infrastructure`), each with a PromQL expression, a `for:` duration, a `severity` label (`critical`/`warning`), a `channel` label (`pagerduty`/`slack-infra-alerts`/`slack-engineering`), and human-readable `summary`/`description`/`runbook` annotations. `infrastructure/docker/prometheus/prometheus.yml` already loads this file (`rule_files: - 'alert-rules.yml'`), so Prometheus itself is already evaluating these rules right now. What's genuinely missing:
  1. **No Alertmanager is deployed anywhere.** `prometheus.yml`'s `alerting.alertmanagers` block is literally `static_configs: - targets: []` with the comment `# Configure alertmanager endpoint in production`. `docker-compose.yml` has no `alertmanager` service. So every one of those 13 rules can fire (visible in the Prometheus UI's Alerts tab) but **nothing receives, dedupes, routes, or notifies on them** — the `severity`/`channel` labels are inert metadata today, not a working routing key.
  2. **Metric names in the alert rules are real, not aspirational** — verified against `packages/logger/src/erp-metrics.ts`, which defines exactly: `erp_invoice_create_total`, `erp_invoice_create_failed_total`, `erp_saga_active_count`, `erp_saga_stalled_count`, `erp_saga_failed_total`, `erp_saga_compensation_total`, `erp_dlq_depth`, `erp_outbox_pending_count`, `erp_stock_available_qty`, `erp_stock_negative_total`, `erp_auth_login_total`, `erp_auth_brute_force_total`, `erp_http_request_total`, `erp_http_error_total`, `erp_http_request_duration_ms` (histogram), `erp_outbox_relay_total`. The existing alert rules correctly reference `erp_dlq_depth`, `erp_saga_stalled_count`, `erp_saga_compensation_total`, `erp_stock_available_qty`, `erp_invoice_create_total`/`erp_invoice_create_failed_total` — good, these are not made-up metric names.
  3. **Two metrics named explicitly in this package's own brief have zero matching alert rule today**: `erp_outbox_pending_count` (outbox lag — no rule anywhere references it) and `erp_auth_brute_force_total` (auth brute-force spike — no rule anywhere references it). The existing `StockWentNegative` rule uses `erp_stock_available_qty < 0` as a proxy rather than the purpose-built `erp_stock_negative_total` counter directly — worth switching to the counter (a `rate()` on a monotonic counter is a more standard negative-stock-events-per-minute signal than a point-in-time gauge floor check, though the existing gauge check is not wrong, just less precise about "how often," only "is it currently below zero").
  4. **Kubernetes manifests already scrape Prometheus metrics via pod annotations** (`prometheus.io/scrape: "true"` etc. in every `infrastructure/k8s/*.yaml`) but there is no `infrastructure/k8s/alertmanager.yaml` and no `infrastructure/k8s/prometheus.yaml` at all — the Prometheus/Alertmanager stack itself is docker-compose-only today; there is no Kubernetes-native equivalent, which matters once PG-022's Helm chart work moves workloads to a real cluster.
- **Current architecture:** Prometheus (docker-compose `prometheus` service, `prom/prometheus:v3.1.0`) scrapes all 13 running backend services (api-gateway excluded) plus `node-exporter`, `kafka` (JMX exporter on 9308), `postgres-exporter`, `redis-exporter` every 15-30s, and evaluates `alert-rules.yml` on the same `evaluation_interval: 15s`. Grafana (docker-compose `grafana` service) reads from the same Prometheus datasource for dashboards only — it has no alerting role in this stack today (Grafana *can* alert natively as of v9+, but this stack doesn't use that; Alertmanager is the intended path per `prometheus.yml`'s own comment).
- **Current limitations:** No Alertmanager instance (docker-compose or k8s) → no real Slack webhook / PagerDuty integration key configured anywhere → the `channel` label taxonomy already authored in `alert-rules.yml` has no receiver to route to → `erp_outbox_pending_count` and `erp_auth_brute_force_total` have zero alert coverage despite being named as target metrics in this package's own scope.

## Existing Code Analysis

- **What already exists and should be reused:** `infrastructure/docker/prometheus/alert-rules.yml` in full — do not rewrite these 13 rules from scratch; extend the file with the missing outbox-lag and auth-brute-force rules, and reuse the exact `severity`/`channel` label taxonomy (`critical`/`warning`, `pagerduty`/`slack-infra-alerts`/`slack-engineering`) already established there as the Alertmanager routing key, rather than inventing a new taxonomy. `packages/logger/src/erp-metrics.ts`'s metric names as the vocabulary for any new rule — do not invent new metric names when an existing one already covers the signal.
- **What should never be modified:** The 13 existing alert rules' PromQL expressions and thresholds — they were evidently tuned deliberately (5% error rate, 2000ms P95, DLQ depth >10, etc.); this package adds coverage and a delivery mechanism, it does not re-tune existing thresholds without a specific reason to.
- **Prior related work:** None found under `ERP-PLANNING/phase-completions/` specifically about alerting/Alertmanager — this appears to be the first package to actually close the loop from "rules exist" to "notifications fire." `dr-drill-report.md`'s recommendation #2 ("Automate DR trigger: Prometheus alert `DBPrimaryDown` → PagerDuty → runbook automation") assumes exactly this Alertmanager path exists — it doesn't yet; this package is a prerequisite for that DR recommendation, worth cross-linking from PG-024.

## Architecture

- Add an **Alertmanager** service: `docker-compose.yml` gets a new `alertmanager` service (`prom/alertmanager:v0.27.0` or current stable), mounted config at `infrastructure/docker/alertmanager/alertmanager.yml`, port `9093`. `prometheus.yml`'s `alerting.alertmanagers.static_configs.targets` changes from `[]` to `['alertmanager:9093']`.
- Alertmanager routing tree keyed on the **existing** `channel` label (not a new label): a top-level route with `group_by: ['alertname', 'service']`, and three sub-routes matching `channel: pagerduty` / `channel: slack-infra-alerts` / `channel: slack-engineering`, each with its own receiver. `severity: critical` alerts additionally get a shorter `group_wait`/`repeat_interval` than `severity: warning` ones (e.g. critical: 30s wait / 1h repeat; warning: 2m wait / 4h repeat) — reuse the severity label already present rather than adding a redundant new one.
- Receivers: `pagerduty` receiver uses a PagerDuty integration key (`PAGERDUTY_SERVICE_KEY`, new secret/env var, not committed); `slack-infra-alerts`/`slack-engineering` receivers use two separate Slack incoming-webhook URLs (`SLACK_INFRA_WEBHOOK_URL`, `SLACK_ENGINEERING_WEBHOOK_URL`) posting to two different channels, matching the existing label split (infra-ops noise vs. engineering/business-logic noise) rather than merging everything into one channel.
- For Kubernetes (PG-022's eventual target): add `infrastructure/k8s/alertmanager.yaml` (Deployment/Service/ConfigMap or a `kube-prometheus-stack` Helm dependency, if PG-022's Helm chart is used as the vehicle — flag this as a follow-up integration point with PG-022 rather than building a second, divergent Prometheus/Alertmanager stack for k8s from scratch in this package).
- Do not route through `notification-service` (the app's business-notification service, e.g. customer SMS/email) — infra alerting is a distinct concern from customer-facing notifications, and Alertmanager's native Slack/PagerDuty receivers are the standard, lower-latency, less-coupled path (no dependency on the app's own DB/Kafka being healthy to alert that the app's DB/Kafka is unhealthy — an important operational-independence property `notification-service` routing would break).

## Database Changes

Not applicable — no schema change. Alertmanager keeps its own in-memory/on-disk silence and notification-log state; no application database involvement.

## Backend

- Add two missing alert rules to `infrastructure/docker/prometheus/alert-rules.yml`:
  - `OutboxLagHigh` (new group or extend `erp.kafka.dlq` group, rename consideration: could live in a new `erp.outbox` group) — `sum(erp_outbox_pending_count) by (tenant_id) > <threshold>` for `>5m`, `severity: warning`, `channel: slack-infra-alerts`, since a growing unpublished-outbox backlog signals the relay worker is stuck or Kafka is unreachable — directly actionable and currently invisible.
  - `AuthBruteForceSpike` (new rule in `erp.business` or a new `erp.security` group) — `sum(rate(erp_auth_brute_force_total[5m])) by (tenant_id) > <threshold>`, `severity: critical`, `channel: pagerduty`, since this is a live-attack signal that should page, not just log.
  - Consider switching `StockWentNegative`'s expression from `min(erp_stock_available_qty) by (...) < 0` to additionally alert on `increase(erp_stock_negative_total[5m]) > 0` — keep both if there's value in "currently negative" (gauge) vs. "a negative-stock event just happened" (counter) as distinct signals; don't remove the existing rule, add alongside it if the distinction is judged worth the extra rule.
- No service code changes needed — all referenced metrics already exist and are instrumented (`erp-metrics.ts` is fully wired per the codebase's own prior work; this package only adds Alertmanager plumbing and rule coverage, not new instrumentation).
- Telemetry: Alertmanager itself exposes its own Prometheus metrics (`alertmanager_notifications_total`, `alertmanager_notifications_failed_total`) — add these to `prometheus.yml`'s own `scrape_configs` so alert-delivery failures are themselves observable (a meta-alert on "alerting is broken" is a well-known best practice worth the small addition).

## Frontend

Not applicable — backend/infra-only gap. (If a future package wants an in-app "active alerts" widget sourced from Alertmanager's API, that would be a separate, additive frontend package, not part of this one.)

## API Contract

Not applicable — no application REST endpoints added. Alertmanager exposes its own management API (`:9093/api/v2/alerts`, silences, etc.) which is an operational tool, not part of this repo's API surface.

## Multi-Tenant Considerations

- Several of the target metrics are already tenant-scoped in their label sets (`erp_stock_available_qty{tenant_id=...}`, presumably `erp_outbox_pending_count` if it's tagged per-tenant — verify the exact label set in `erp-metrics.ts` before finalizing the new rule's `by (...)` clause) — alert rules and their annotations should surface `tenant_id` in the message so on-call engineers know which tenant is affected, not just that "some tenant" has an issue.
- No per-tenant alert routing (e.g., a specific enterprise tenant getting its own Slack channel) is in scope here — that would be a future enhancement, not a gap this package needs to close.

## Integration

- **Prometheus** (`infrastructure/docker/prometheus/`) — config change to point at the new Alertmanager; new/extended alert rules.
- **docker-compose.yml** — new `alertmanager` service.
- **Slack** — two incoming webhooks (infra-ops, engineering) as the primary low-friction notification channel.
- **PagerDuty** — one integration key for `critical`-severity alerts, reusing the routing key already present as the `channel: pagerduty` label.
- **PG-022 (Kubernetes)** — this package's Alertmanager should eventually also run in-cluster; coordinate rather than duplicate when PG-022's Helm chart exists.
- **PG-024 (Backup/DR)** — `dr-drill-report.md`'s own recommendation #2 (automated DR trigger via a Prometheus alert) is only achievable once this package's Alertmanager exists; cross-link both ways.

## Coding Standards

- Alertmanager/Prometheus config is YAML, not application TypeScript — match the existing `alert-rules.yml` style (grouped by domain, `severity`/`channel` labels, `summary`/`description`/`runbook` annotations on every rule) for any new rule added. No new labeling convention introduced without extending the one already established.
- Secrets (`PAGERDUTY_SERVICE_KEY`, Slack webhook URLs) follow this repo's existing convention of env-var-injected, never-committed secrets (same pattern as `.env.example` placeholders for other integrations) — add placeholder entries to `.env.example` documenting the required variables without real values.

## Performance

- Alertmanager's `group_wait`/`group_interval`/`repeat_interval` tuning (per severity tier, see Architecture) avoids notification storms when many alerts fire simultaneously (e.g. a full outage triggering `PodCrashLooping` for all 14 services at once should group into one notification, not 14).
- No caching/indexing concerns — this is a low-volume control-plane addition (Prometheus already handles the query load; Alertmanager's own footprint is minimal).

## Security

- PagerDuty integration key and Slack webhook URLs must be treated as secrets (not committed, injected via env var / k8s Secret once PG-022 lands) — a leaked Slack webhook lets an attacker post arbitrary messages impersonating this alerting pipeline, and a leaked PagerDuty key lets an attacker trigger/suppress pages.
- Alertmanager's own web UI (`:9093`) should not be publicly exposed without auth in production — same posture as Prometheus/Grafana today (docker-compose exposes them on host ports for local dev only; production/staging should sit behind the same network boundary, not on a public port).
- No new OWASP category — this closes an operational-visibility gap (arguably related to insufficient logging/monitoring, OWASP A09:2021, which alerting directly mitigates).

## Testing

- `amtool config check infrastructure/docker/alertmanager/alertmanager.yml` (Alertmanager's own config validator) as a lint step, addable to CI's existing `lint` job or a small new step.
- `promtool check rules infrastructure/docker/prometheus/alert-rules.yml` (Prometheus's own rule validator, catches PromQL syntax errors) — this should have existed already given the file is non-trivial; add it now regardless of whether it's scoped to "new rules only."
- Manual validation: run `docker compose up alertmanager prometheus`, fire a synthetic alert (e.g., temporarily lower a threshold or use `amtool alert add` to inject a test alert), and confirm it actually lands in the configured Slack channel / PagerDuty test incident before calling this done — do not consider the config file alone sufficient proof.

## Acceptance Criteria

- [ ] `docker compose up` brings up a working `alertmanager` service, and Prometheus's own `/alertmanagers` status page shows it as a healthy target (not the current empty `targets: []`).
- [ ] A deliberately-fired test alert for each of the three `channel` values (`pagerduty`, `slack-infra-alerts`, `slack-engineering`) actually arrives in the correct real destination (PagerDuty test incident / correct Slack channel).
- [ ] `OutboxLagHigh` and `AuthBruteForceSpike` alert rules exist, pass `promtool check rules`, and can be shown to fire against a manually-inflated test value of their respective metrics.
- [ ] Alertmanager's own delivery-failure metrics are scraped by Prometheus (so "alerting silently broke" is itself observable).
- [x] `.env.example` documents the new required secrets (`PAGERDUTY_SERVICE_KEY`, `SLACK_INFRA_WEBHOOK_URL`, `SLACK_ENGINEERING_WEBHOOK_URL`) without real values committed.

## Deliverables

- **Files to create:** `infrastructure/docker/alertmanager/alertmanager.yml`.
- **Files to modify:** `docker-compose.yml` (new `alertmanager` service), `infrastructure/docker/prometheus/prometheus.yml` (point `alerting.alertmanagers` at the new service; add Alertmanager's own metrics to `scrape_configs`), `infrastructure/docker/prometheus/alert-rules.yml` (add `OutboxLagHigh`, `AuthBruteForceSpike`, optionally extend `StockWentNegative`), `.env.example` (new secret placeholders).
- **Migrations:** none.
- **APIs added/changed:** none.
- **Events added/changed:** none.
- **Tests added:** `amtool config check` + `promtool check rules` as CI-addable lint steps; a documented manual test-alert procedure (not an automated test, since it requires real Slack/PagerDuty credentials).

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `infrastructure/docker/prometheus/alert-rules.yml` already contains 13 well-formed alert rules across 5 groups, referencing real, already-instrumented `erp_*` Prometheus metrics defined in `packages/logger/src/erp-metrics.ts`. `prometheus.yml` already loads this rule file and evaluates it continuously. The only reason none of this produces a human-visible notification today is that `prometheus.yml`'s `alerting.alertmanagers` target list is empty and no Alertmanager instance exists anywhere in `docker-compose.yml` or `infrastructure/k8s/`. Two metrics this package's own scope names as targets (`erp_outbox_pending_count`, `erp_auth_brute_force_total`) have zero existing alert-rule coverage despite being real, instrumented metrics.

**Current Objective:** Deploy Alertmanager (docker-compose first; note the k8s equivalent as a PG-022 coordination point), route the already-authored `severity`/`channel` labels to real Slack webhooks and a PagerDuty integration key, and add the two missing alert rules (outbox lag, auth brute-force spike).

**Architecture Snapshot:**
1. This package's originating brief was wrong to say no alerting-rule layer exists — 13 rules already exist and reference real metrics; the actual gap is purely the missing Alertmanager + notification channels + 2 rule gaps.
2. Metric vocabulary lives in `packages/logger/src/erp-metrics.ts` — check there before assuming a metric doesn't exist.
3. The existing `channel` label (`pagerduty`/`slack-infra-alerts`/`slack-engineering`) is the intended routing key — reuse it, don't invent a parallel taxonomy.
4. Do not route infra alerts through the app's own `notification-service` — that creates a circular dependency (alerting about the app being down, routed through a component of the app).

**Completed Components:** The 13 existing alert rules and all underlying metric instrumentation — do not re-author these.

**Pending Components:** Alertmanager deployment (docker-compose + eventual k8s), real Slack/PagerDuty receiver wiring, the two missing alert rules, Alertmanager's own meta-monitoring.

**Known Constraints:** Real Slack webhook URLs and a real PagerDuty integration key are required to fully verify delivery — if unavailable in a given session, validate config syntax (`amtool config check`, `promtool check rules`) and document that live-delivery verification is still pending, rather than claiming it was tested end-to-end.

**Coding Standards:** Match `alert-rules.yml`'s existing style (grouped rules, `severity`/`channel` labels, `summary`/`description`/`runbook` annotations) for any new rule.

**Reusable Components:** `alert-rules.yml`'s existing 13 rules and label taxonomy; `erp-metrics.ts`'s metric names; `prometheus.yml`'s existing scrape/rule-file wiring.

**APIs Already Available:** Not applicable to this package (no app REST endpoints involved).

**Events Already Available:** Not applicable.

**Shared Utilities:** `packages/logger/src/erp-metrics.ts` (metric definitions — read, don't duplicate).

**Feature Flags:** Not applicable.

**Multi-Tenant Rules:** Surface `tenant_id` in alert annotations where the underlying metric is tenant-scoped; no per-tenant alert routing in this package's scope.

**Security Rules:** Treat PagerDuty key and Slack webhook URLs as secrets, never committed; Alertmanager UI must not be publicly exposed without auth in production.

**Database State:** Not applicable.

**Testing Status:** No `promtool`/`amtool` validation exists in CI today — this package should add it.

**Next Session Plan:** Single session is realistic (the hard authoring work — the 13 rules — is already done); if Slack/PagerDuty credentials aren't available to test with, split live-delivery verification into a quick follow-up once credentials exist.

**Prompt for the Next Session:** "Open `ERP-PLANNING/production-gap-prompts/003-Infrastructure/14-alerting-on-prometheus-metrics.md` and implement PG-023: deploy Alertmanager (docker-compose), wire it to the already-existing `infrastructure/docker/prometheus/alert-rules.yml` rules via the existing `severity`/`channel` labels, connect real Slack/PagerDuty receivers, and add the two missing alert rules for `erp_outbox_pending_count` and `erp_auth_brute_force_total`. Re-verify `alert-rules.yml` and `prometheus.yml`'s current state first — this package's own brief already had to correct a wrong 'no alerting exists' assumption once."
