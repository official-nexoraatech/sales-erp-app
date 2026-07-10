# ERP Production Gap Closure — Master Roadmap

**Source of truth:** `ERP-PLANNING/reports/FEATURE_INVENTORY.md` (generated 2026-07-08, direct source-code audit). This roadmap decomposes every gap identified there — plus a handful confirmed by direct grep during this pass — into standalone, independently implementable work packages.

**One correction to the source document, verified by grep during this pass:** FEATURE_INVENTORY.md §2 says tenant brand "radius scale stored but not applied." As of this roadmap's authoring (2026-07-08), `TenantThemeSync.tsx` and `tokens.css` already apply the radius scale — this was shipped the same day the inventory doc was generated, likely just after. **No package exists for it; treat it as closed.** This is a reminder that the inventory is a snapshot — re-verify any given claim against current code before starting its package, since concurrent work may have already closed it (see `[[concurrent_sessions_on_same_repo]]` in project memory).

**Scope decision:** No `Sales/` or `Purchase/` category folders were created. The inventory names zero unresolved gaps specific to those two modules — everything sales/purchase-adjacent that IS a gap (RBAC drift, permission mismatches, event-service stubs) is cross-cutting and lives under Architecture/Security. Inventing module-specific packages where the source document identifies none would violate this roadmap's own "don't manufacture gaps" rule.

---

## Phase 1 — Dependency Graph (how the pieces connect)

```
auth-service ──(JWT, permissions)──> every service (preHandler)
tenant-service ──(tenant/branch/feature-flag context)──> every service
                └─ tenant lifecycle (suspend/close) SHOULD gate every request (PG-012, currently doesn't)

event-service ──(outbox relay, Kafka)──> accounting-service, gst-service, search-service, notification-service
                └─ Saga registry (PG-006), DLQ replay (PG-007), Projection rebuild (PG-008) are the
                   reliability backbone every async workflow implicitly depends on — currently hollow.

sales-service ──invoice/payment/return events──> accounting-service (journal posting)
                                              └──> gst-service (GST ledger)
purchase-service ──GRN/payment events──> accounting-service, inventory-service (stock)
inventory-service ──stock events──> sales-service (availability), accounting-service (COGS)
hr-service ──payroll approve/disburse events──> accounting-service (accrual/clearing journals)

web-frontend + pos-frontend ──> call all 14 services directly (no gateway — PG-001 changes this)

report-service, search-service ──> read-only consumers of the same event stream + direct DB reads

Everything sits on: single shared Postgres (no RLS) + Kafka + Redis (direct ioredis, PG-002 changes this)
                     + MinIO + Elasticsearch + Vault (unused, PG-004 changes this)
```

**Implication for sequencing:** anything that touches the outbox/Kafka/permission layer (Phase 0) is upstream of nearly everything else. Business-module gaps (GST/Accounting/HR) are leaves — they can be parallelized freely once Phase 0 is stable, and across each other.

---

## Phase 2 — Master Gap List (grouped, prioritized)

Legend: **C**ritical (blocks production) · **H**igh (strongly recommended pre-launch) · **M**edium (should do) · **L**ow (nice to have)

### Architecture — `001-Architecture/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-001 | [API Gateway implementation](001-Architecture/22-api-gateway.md) | C | XL |
| PG-002 | [Shared cache package (`@erp/cache`)](001-Architecture/23-shared-cache-package.md) | H | M |
| PG-003 | [Event-bus-client consolidation](001-Architecture/24-event-bus-client-consolidation.md) | H | M |
| PG-004 | [Vault secrets integration](001-Architecture/13-vault-secrets-integration.md) | H | L |
| PG-005 | [Postgres read-replica utilization](001-Architecture/21-postgres-read-replica-utilization.md) | M | M |
| PG-006 | [Saga orchestration registration](001-Architecture/06-saga-orchestration-registration.md) | C | L |
| PG-007 | [DLQ real Kafka replay](001-Architecture/07-dlq-real-replay.md) | C | S |
| PG-008 | [Projection rebuild — real implementation](001-Architecture/08-projection-rebuild-real-implementation.md) | H | M |
| PG-009 | [Export-job — real file generation](001-Architecture/09-export-job-real-implementation.md) | C | M |
| PG-010 | [Service discovery & API versioning strategy](001-Architecture/25-service-discovery-api-versioning.md) | M | M |
| PG-011 | [Distributed transaction / idempotency standardization](001-Architecture/26-distributed-transaction-idempotency-standardization.md) | M | M |

### Security — `002-Security/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-012 | [Tenant suspension/closure enforcement](002-Security/01-tenant-suspension-enforcement.md) | C | S |
| PG-013 | [Fix `GET /organization` / `GET /branches` missing permission checks](002-Security/02-organization-branches-permission-fix.md) | C | S |
| PG-014 | [RBAC dead permission constants remediation](002-Security/03-rbac-dead-permission-constants.md) | C | M |
| PG-015 | [event-service DLQ/SAGA permission granularity fix](002-Security/10-event-service-dlq-saga-permission-granularity.md) | H | S |
| PG-016 | [Frontend permission constants — shared import](002-Security/04-frontend-permission-constants-shared-import.md) | H | S |
| PG-017 | [Password reset email delivery — real send](002-Security/05-password-reset-email-delivery.md) | C | S |
| PG-018 | [Impersonation frontend UI](002-Security/11-impersonation-frontend-ui.md) | H | M |
| PG-019 | [Orphaned `admin/audit-logs` route — wire into nav](002-Security/12-orphaned-audit-logs-route.md) | H | S |
| PG-020 | [SSO/OAuth/SAML integration](002-Security/15-sso-oauth-saml.md) | M | L |

### Infrastructure — `003-Infrastructure/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-021 | [CI staging-deploy — real implementation](003-Infrastructure/16-ci-staging-deploy-real-implementation.md) | C | M |
| PG-022 | [Kubernetes production readiness](003-Infrastructure/17-kubernetes-production-readiness.md) | M | XL |
| PG-023 | [Alerting on existing Prometheus metrics](003-Infrastructure/14-alerting-on-prometheus-metrics.md) | H | M |
| PG-024 | [Backup & disaster recovery strategy](003-Infrastructure/18-backup-disaster-recovery.md) | H | L |
| PG-025 | [Centralized log aggregation (Loki) rollout](003-Infrastructure/19-centralized-log-aggregation-loki.md) | M | M |
| PG-026 | [Scheduler log-only stub jobs — real implementations](003-Infrastructure/20-scheduler-log-only-stub-jobs.md) | H | M |

### Platform — `004-Platform/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-027 | [Subscription/billing/license management](004-Platform/29-subscription-billing-license-management.md) | M | XL |
| PG-028 | [Usage tracking & metering](004-Platform/30-usage-tracking-metering.md) | M | L |
| PG-029 | [Tenant provisioning — real S3/MinIO bootstrap](004-Platform/27-tenant-provisioning-s3-bootstrap.md) | H | S |
| PG-030 | [First platform-operator bootstrap mechanism](004-Platform/28-first-platform-operator-bootstrap.md) | H | S |

### Inventory — `005-Inventory/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-031 | [Remove dead `GET /items/:id/stock` stub](005-Inventory/43-remove-dead-stock-stub-endpoint.md) | L | S |
| PG-032 | [True per-warehouse valuation](005-Inventory/44-true-per-warehouse-valuation.md) | M | L |

### Accounting — `006-Accounting/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-033 | [Real Income Summary account for year-end close](006-Accounting/34-real-income-summary-account.md) | M | M |
| PG-034 | [Cash flow report — investing & financing sections](006-Accounting/35-cash-flow-investing-financing-sections.md) | M | M |
| PG-035 | [Opening balance wizard — full trial-balance validation](006-Accounting/36-opening-balance-full-trial-balance-validation.md) | M | S |
| PG-036 | [Multi-currency support](006-Accounting/57-multi-currency-support.md) | L | XL |
| PG-037 | [Departments / cost centers](006-Accounting/58-departments-cost-centers.md) | L | L |

### GST — `007-GST/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-038 | [GSTR-1 — real Excel export](007-GST/31-gstr1-real-excel-export.md) | H | S |
| PG-039 | [GSTR-3B — RCM/import/ITC-reversal bucket computation](007-GST/32-gstr3b-rcm-import-itc-reversal-buckets.md) | H | L |
| PG-040 | [GSTR-9 — real Table 9 tax-paid tracking](007-GST/33-gstr9-real-tax-paid-tracking.md) | M | M |

### HR — `008-HR/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-041 | [Biometric attendance import — real integration](008-HR/37-biometric-attendance-import.md) | M | L |
| PG-042 | [Employee photo/document upload — real storage](008-HR/38-employee-photo-document-upload.md) | H | S |
| PG-043 | [Bulk employee/attendance import — real processing](008-HR/39-bulk-employee-attendance-import.md) | H | M |
| PG-044 | [Multi-state Professional Tax slabs](008-HR/40-multi-state-professional-tax.md) | M | M |
| PG-045 | [Payroll loan deductions](008-HR/41-payroll-loan-deductions.md) | M | M |

### Production — `009-Production/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-046 | [Reorder auto-PO — real GST rate lookup](009-Production/42-reorder-auto-po-real-gst-rate.md) | H | S |

### Notifications — `010-Notifications/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-047 | [Configurable quiet hours (currently hardcoded IST)](010-Notifications/50-configurable-quiet-hours.md) | L | S |

### Reporting — `011-Reporting/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-048 | [Scheduled report delivery — distributed lock](011-Reporting/45-scheduled-report-distributed-lock.md) | M | S |

### Search — `012-Search/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-049 | [Search-service horizontal scaling / ES cluster readiness](012-Search/51-search-horizontal-scaling.md) | L | M |

### POS — `013-POS/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-050 | [POS shift / cash-drawer frontend UI](013-POS/46-pos-shift-cash-drawer-ui.md) | H | M |
| PG-051 | [POS branch-picker UI](013-POS/47-pos-branch-picker-ui.md) | H | S |
| PG-052 | [POS native hardware integration](013-POS/48-pos-native-hardware-integration.md) | M | L |

### Web — `014-Web/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-053 | [Mobile responsiveness audit & fixes](014-Web/49-mobile-responsiveness-audit.md) | M | L |

### Testing — `015-Testing/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-054 | [E2E coverage expansion beyond mocked-API smoke suite](015-Testing/52-e2e-coverage-expansion.md) | M | L |
| PG-055 | [Load/performance testing harness](015-Testing/53-load-performance-testing-harness.md) | M | M |
| PG-056 | [Recurring chaos-engineering cadence](015-Testing/54-recurring-chaos-engineering-cadence.md) | L | S |

### Deployment — `016-Deployment/`
| ID | Package | Priority | Complexity |
|---|---|---|---|
| PG-057 | [Production deployment runbook & rollback strategy](016-Deployment/55-production-deployment-runbook-rollback.md) | H | M |
| PG-058 | [Blue/green or canary release strategy](016-Deployment/56-blue-green-canary-release-strategy.md) | L | L |

**58 packages total.** Complexity/dependency/risk detail for each lives in its own file (see the "Complexity" line and "Depends on" / "Blocks" header fields in every package).

---

## Phase 3 — Master Roadmap (phase sequencing)

### Phase 0 — Critical Fixes (do first, no new features)
Fix what is silently broken or silently insecure *right now*, in production-like conditions, with no dependency on later phases.
**Packages:** PG-012, PG-013, PG-014, PG-015, PG-016, PG-017, PG-006, PG-007, PG-009, PG-008
**Deliverable:** every request from a suspended/closed tenant is rejected; no unauthenticated-permission data leaks; RBAC constants match reality; password reset actually works; async workflows (saga/DLQ/projection/export) do what their UI claims.
**Validation:** re-run the RBAC/tenant-isolation section of `ARCHITECTURE_AUDIT_REPORT.md` and confirm every finding there is closed.

### Phase 1 — Security Hardening
**Packages:** PG-018, PG-019, PG-020, PG-004, PG-023
**Deliverable:** impersonation is reachable and auditable end-to-end; secrets come from Vault not env vars; alerts fire on the metrics already being collected.

### Phase 2 — Infrastructure Foundation
**Packages:** PG-021, PG-022, PG-024, PG-025, PG-026, PG-005
**Deliverable:** CI can actually deploy to staging; backup/DR is documented and tested; the 31 scheduler jobs that currently log-and-do-nothing do real work; read traffic can be offloaded to the replica.

### Phase 3 — Platform Foundation
**Packages:** PG-001, PG-002, PG-003, PG-010, PG-011, PG-027, PG-028, PG-029, PG-030
**Deliverable:** a real API Gateway fronts all 14 services (auth/rate-limit/routing centralized); cache and event-bus usage is consistent instead of ad hoc per-service `ioredis`/`kafkajs`; tenant provisioning has no fake steps; platform can be commercially operated (billing/usage).

### Phase 4 — Business Module Completeness
**Packages:** PG-038, PG-039, PG-040, PG-033, PG-034, PG-035, PG-041, PG-042, PG-043, PG-044, PG-045, PG-046, PG-031, PG-032, PG-048
**Deliverable:** every "documented simplification" or stub in GST/Accounting/HR/Inventory/Production either becomes real or is a deliberate, re-confirmed product decision.

### Phase 5 — UI/UX Improvements
**Packages:** PG-050, PG-051, PG-052, PG-053, PG-047
**Deliverable:** POS has no backend-only dead features; the app is usable on mobile viewports; notification quiet-hours are tenant-configurable.

### Phase 6 — Performance & Scale
**Packages:** PG-049, plus load-testing findings from Phase 7 feeding back in
**Deliverable:** search and read paths are validated at target tenant/transaction volume.

### Phase 7 — Testing
**Packages:** PG-054, PG-055, PG-056
**Deliverable:** E2E coverage beyond smoke, a repeatable load-test harness, chaos engineering on a recurring cadence (not a one-off — see existing `ERP-PLANNING/phase-completions/chaos-engineering-report.md`).

### Phase 8 — Production Readiness
**Packages:** PG-057
**Deliverable:** a runbook a human can follow at 2am, with a tested rollback path.

### Phase 9 — Enterprise Enhancements
**Packages:** PG-058, PG-036, PG-037, PG-020 (SSO, if deferred from Phase 1 for a specific enterprise customer commitment)
**Deliverable:** the differentiators that matter for large/multi-national customers specifically, deliberately deferred past core production-readiness.

Each phase file should be read as: nothing in phase N+1 is *blocked* by phase N unless a package's own "Depends on" field says so — the phase numbers are a recommended sequence for risk-reduction, not a hard gate. Business-module packages (Phase 4) and module-owning teams can run in parallel with Phase 1-3 architecture work once Phase 0 lands, since they touch different files.

---

## Phase 8 (of the source prompt) — Multi-Session Execution Strategy

This backlog is too large for one AI session. Rules for running it across sessions:

1. **One package = one session** (or, for `XL` complexity packages — PG-001, PG-022, PG-027, PG-036 — split further using that package's own "Next Session Plan" field).
2. **Always open a fresh session with the package file itself**, not a summary of it — the file's "Context Preservation" section at the bottom is written to be a complete, standalone briefing.
3. **Before starting implementation, re-verify the "Current implementation" claims in the package** against the live codebase (`grep`/`read` the named files). Gaps get closed by concurrent work between when this roadmap was written and when a session picks up a package — see `[[concurrent_sessions_on_same_repo]]`. Treat every "current state" claim as a hypothesis to confirm, not a fact to build on blind.
4. **After finishing a package, update its Deliverables section** (check off what was actually built vs. deferred) rather than writing a new completion doc, unless the project's existing convention (`ERP-PLANNING/phase-completions/ES-XX_COMPLETION.md`) is what the team wants to keep using — if so, cross-link both ways.
5. **Do not reopen Phase 0 packages casually.** They were prioritized Critical because they are either a live security exposure or a silently-fake feature; if a Phase 0 package is found already partially fixed by concurrent work, verify fully and close it rather than re-implementing.

---

## Enterprise Architecture Guidance (cross-cutting, applies to every package)

- **Coding standards:** Fastify + Zod + Drizzle across all backend services; `requirePermission()` preHandler for authz; Winston (`@erp/logger`) for logging; OpenTelemetry spans + `prom-client` counters for observability; React + the shared ERP component library + `design-tokens` package on the frontend; permission gating via `PermissionGate`/`usePermission()`/`PermissionRoute`, all sourced from `web-frontend/src/lib/navigation.ts`. No package in this backlog should introduce a second way to do any of these.
- **Multi-tenancy:** every table carries `tenant_id`; there is no RLS and no per-tenant schema — isolation is enforced entirely in application code (`requirePermission` + explicit `WHERE tenant_id = ?`). Any new table/query in these packages must follow that same explicit-filter convention.
- **Reuse over rebuild:** before any package introduces a new utility, check `@erp/sdk` (audit, saga, rate-limit, storage, telemetry, feature-flags, rule-engine, workflow), `@erp/types`, `@erp/utils`, `@erp/logger`, `@erp/config` — most cross-cutting needs already have a home there.
- **Backward compatibility:** these are gap-closures on a live schema/API surface, not a rewrite. Every migration must be additive/reversible; no package here should require a breaking API version bump unless its own file explicitly justifies one (only PG-010 is expected to touch versioning strategy).
