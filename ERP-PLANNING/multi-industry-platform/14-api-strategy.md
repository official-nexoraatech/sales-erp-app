# 14 — API Strategy

## 1. Current state (verified — largely a strength)

`apps/api-gateway/src/config.ts`'s `UPSTREAM_DEFAULTS` already implements real API versioning (`apiV2: true` → `/api/v2` rewrite) for 12/16 services, with a deliberate, documented deprecation window for the remaining 4 (`report`, `production`, `event` — plus `crm`, not yet routed since it has no domain routes). Both frontends already route through the gateway (`01-current-state.md` §17) — this corrects an earlier assumption (`pg010_api_versioning_completion` memory) that frontends bypass it.

## 2. Extending the pattern to new industry services

A new industry service (or a completed `crm-service` split) follows the exact same onboarding: add an `UPSTREAM_DEFAULTS` entry (`service`, `envVar`, default port, `apiV2: true`), a Dockerfile + K8s manifest matching the existing 16 (`infrastructure/k8s/*.yaml` convention), and register its base URL in both frontends' `client.ts`-equivalent. No gateway code changes beyond the config map entry — the proxy mechanism (`@fastify/http-proxy`) is generic.

## 3. `crm-service` — the one open API-strategy item already in flight

`apps/crm-service` has a gateway config entry (`CRM_SERVICE_URL`, `apiV2: true`) and Docker/K8s scaffolding already, but zero registered routes (`01-current-state.md` §9). Completing the CRM/O2C split (already fully planned per `reportsengine_dedup_and_crm_split_2026_08_16`) is what actually exercises this pattern for a real second cutover, ahead of any brand-new industry service. Recommend treating that split as the validation run for "add a new backend service to the platform," ahead of Phase 10.

## 4. What this plan does not do

Does not introduce gRPC (no concrete need found — brief §10). Does not add a second gateway or split the gateway per-industry (still one gateway, one routing table, per confirmed architecture). Does not change the JWT/authorization model at the gateway (unchanged, `13-security-architecture.md`).
