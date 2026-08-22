# 08 — API, Event, Reporting & Search Architecture Audit

## Part A — Navigation & API architecture

### Nav-hiding vs. real security — verdict: no blocker found

`filterNavItem` (`apps/web-frontend/src/lib/navigation.ts:974-988`) checks capability then permission, is explicitly documented in-code as "UX filtering only... backend requireCapability() remains authoritative," and this checked out for every route independently tested. `PermissionRoute` (`App.tsx:350-361`, guards ~130 routes) checks permission only, never capability — so direct URL navigation to a capability-gated page can render the shell — but the backend independently closes this for POS, HR_PAYROLL, and INVENTORY_BATCH (each has its own `requireCapability()` server-side, verified, with dedicated authz tests). `ERPCommandPalette.tsx:128` reuses the identical filter function as the sidebar, so it exposes nothing extra.

**The one real gap** mirrors the Manufacturing finding in `05-capability-entitlement-rbac.md`: `BOM`/`WORK_CENTERS` are registered capabilities, but neither the nav (`navigation.ts:660-670` sets `permission` only, no `capabilityKey`) nor the backend (`bom.routes.ts`/`work-center.routes.ts`, `requirePermission` only) gates them by plan. Currently inert only because the underlying permissions aren't granted to any default role — but this is the closest thing to a "hiding = security" pattern found anywhere, and it's a backend gap, not a frontend one.

### API reusability for new industries — verdict: additive pattern, confirmed by every prior vertical

`customerApi`, `itemApi`, `invoiceApi`, `paymentApi` (`apps/web-frontend/src/api/endpoints.ts`) are industry-agnostic CRUD, unmodified by any vertical addition to date. Every prior vertical added **net-new** API groups instead: `fabricRollApi` for Cloth, entirely new `bom.routes.ts`/`work-center.routes.ts` files for Manufacturing, rather than touching `item.routes.ts`. `packages/ui/src/` has zero hardcoded industry strings (grepped fabric/cloth/garment/textile/grocery/batch/manufactur — no hits) — a Hotel vertical would need new pages/API groups but not touch the shared component library.

### Gateway versioning, idempotency, error shape

- **Versioning**: 15 of 17 upstreams route through `/api/v2`; 2 exceptions (`report-service`, `production-service`/`event-service`) are a documented in-progress migration, not an oversight (report-service dual-registers its own v1/v2 paths; the other two's specific reasoning was not confirmed in this pass). Rated **doc-only/low**.
- **Idempotency**: no platform-wide `Idempotency-Key` convention exists anywhere in `apps/api-gateway/src` (zero references). Each write-heavy flow that needs dedup (Razorpay payments, POS offline sales) built its own ad hoc mechanism. Not broken, but a new mutating endpoint has no established pattern to copy. Rated **MEDIUM** (completeness gap).
- **Error shape**: confirmed consistent via one shared `registerErrorHandler()` (`packages/platform-sdk/src/error-handler.ts`), used identically by accounting/sales/hr-service — a previously-fixed platform-wide gap, confirmed still fixed, no regression. Rated **doc-only**.

## Part B — Event architecture

### KafkaTopics vs. real topic derivation — still mismatched, still duplicated

`packages/shared-types/src/events.ts:69-77`'s `KafkaTopics` interface remains exported but unused. The **actual** publish-time topic transform (`apps/event-service/src/outbox/OutboxRelayWorker.ts:153`) is independently reimplemented **4 separate times** (OutboxRelayWorker, automation-service's `topicFor()`, search-service's `topicForEventType`, accounting-service's hardcoded literal list) with no shared helper. Not a runtime bug today (nothing consumes the stale interface), but a live foot-gun for the next engineer reaching for topic-name type safety, and a naming-convention change would require 4 coordinated edits. Rated **HIGH**.

### Outbox pattern — VERIFIED genuinely transactional

Confirmed at two services, two call patterns: `apps/sales-service/src/domain/InvoiceService.ts` (raw `trx.insert(outboxEvents)` inside the same transaction as business writes, 4 event types checked) and `apps/accounting-service/src/domain/JournalEngine.ts` (`PlatformEventBus.publishInTransaction()` wrapper). The relay is correctly a separate async process polling `FOR UPDATE SKIP LOCKED`, publishing to Kafka only after releasing the DB lock. No gap.

**New finding — envelope-shape inconsistency**: two incompatible outbox payload wire-shapes coexist (flat business fields vs. a nested `ERPEventPayload` envelope), and this already caused one confirmed production bug — hr-service's `PAYROLL_RUN_APPROVED`/`DISBURSED` events silently posted **zero journals** across multiple E2E runs because the unwrapped envelope hid fields one level deeper than the consumer expected. A shape-sniffing heuristic now works around it, but the root inconsistency (two producer APIs, two wire shapes) is unresolved, and a wrong choice by a new industry's producer fails **silently**, not loudly. Rated **MEDIUM**.

### DLQ — publish-side genuinely fixed; consumer-side processing failures have a real, undiscovered gap

The prior "outbox dead-letters were invisible/unreplayable" claim is **re-verified true and fixed** for outbox-relay publish failures specifically: `OutboxRelayWorker.ts:187-217` inserts into `dlqItems` on retry exhaustion, and `POST /admin/dlq/:topic/replay` (`apps/event-service/src/api/dlq.routes.ts:132-200`) genuinely republishes via a real Kafka `producer.send`, not a stub.

**But a materially similar, currently-live gap exists one layer downstream, not covered by the prior fix**: when a consumer's `handler(event, trx)` throws — i.e., the event was delivered and consumed but the domain logic failed — `PlatformEventConsumer` (`packages/platform-sdk/src/events.ts:205-224`) only marks `inbox_events.status = 'FAILED'`. **No service exposes any admin route to list/inspect/retry failed `inbox_events` rows.** (search-service is the sole exception, with its own hand-rolled consumer-side DLQ write outside the generic mechanism.) A buggy first-cut Manufacturing or Hotel consumer (e.g. `ProductionOrderCompleted` throwing on a malformed payload) would fail exactly this way — invisible, unreplayable, no alert. Rated **HIGH** — this is the specific, concrete answer to "can a new industry add events safely": yes for dispatch mechanics, but not yet for operational visibility into its own bugs.

### Idempotency/retry — VERIFIED, one shared, atomic mechanism

`PlatformEventConsumer.subscribe()` (`events.ts:166-204`) wraps every consume in a transaction that does an atomic UPSERT-as-claim (`onConflictDoUpdate` guarded by `status != 'PROCESSED'`) keyed on `(eventId, consumerService)`. Confirmed used identically by accounting/gst/search-service; individual handlers have no dedup logic of their own (correctly centralized one layer up). No gap.

### Schema registry — VERIFIED passive, not enforced anywhere in the live pipeline

`schema-registry.routes.ts` has real register/compatibility-check logic, but it is **never called** by `OutboxRelayWorker` or `PlatformEventConsumer` — confirmed via grep, zero references outside event-service's own routes. `EVENT_GOVERNANCE.md`'s versioning policy has an API behind it, but nothing in the hot path validates a real event against its registered schema at publish or consume time. This means: a new event type needs zero registry interaction to work (confirmed safe), but the registry also provides **no actual safety net** against a breaking change to an existing shared event's payload — that relies entirely on developer discipline. Rated **HIGH**.

### Can a new industry vertical add events without destabilizing existing consumers? — YES for mechanics, with the 3 caveats above

Two consumer patterns coexist, both safe against unknown event types: automation-service's subscribe-all-and-no-op-if-unmatched, and accounting/search/gst's explicit-topic-list-with-a-safe-`default:`-case. A brand-new event type added to `EventTypes` will not crash or destabilize any existing consumer — confirmed by the fact this pattern has already been exercised for a real new event type (`STOCK_NEAR_EXPIRY`). Caveats: envelope-shape choice (above), consumer-side failure invisibility (above), and no schema-enforcement safety net for future breaking changes (above).

## Part C — Reporting & search

### Report service — tenant-safe; metadata-registry-driven but NOT query-driven

Tenant safety **verified**: `ReportEngine.ts` uses Drizzle's `sql` tag throughout with explicit `WHERE tenant_id = ${tid}` predicates on every case sampled (inline `// ✓ tenant_id filtered` comments from a prior dedicated audit). Extensibility is **partially** config-driven: `ReportRegistry.ts` defines 83 declarative `ReportDefinition` entries, but `ReportEngine.ts`'s `runQuery()` is one large hand-written `switch` with a real SQL case per report — diffed all 83 registry slugs against all 83 switch cases and confirmed a clean 1:1 match (the previously-reported "25 broken + 4 mismatched" gap is fully reconciled, not currently reproducible). A new industry's reports need both a registry entry _and_ hand-written SQL — not config alone. Rated **LOW-MEDIUM** (not a bug, an effort/scalability concern for "many new industries, many new reports").

### Search service — VERIFIED strong tenant isolation; semi-config-driven entity extensibility

Tenant isolation is structural: per-tenant physical Elasticsearch indices (`erp_${tenantId}_${entity}`), plus a redundant query-time filter, plus the field written into every document body — three independent layers. Every route derives `tenantId` from `request.auth`. Adding a new searchable entity type requires 3 additive TypeScript edits across 2 files (a union type, an ES mapping block, an event-map entry) — none touch existing entity logic, a low-blast-radius pattern, but it is source-code change, not runtime config, so "config-driven" is an overstatement. 28 of 29 current `SearchEntity` members are confirmed mapped to real event producers; the previously-fixed `stock` entity gap was independently re-verified as still fixed.

## Ranked findings (Parts A-C combined)

| #   | Finding                                                                                                                                                      | Severity                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 1   | Consumer-side processing failures (`inbox_events.status='FAILED'`) have zero admin visibility/replay path outside search-service's own hand-rolled exception | **HIGH**                                      |
| 2   | Schema registry is passive — no enforcement anywhere in the publish/consume hot path                                                                         | **HIGH**                                      |
| 3   | `KafkaTopics` still exported/unused/inconsistent; topic-derivation logic duplicated in 4 places                                                              | **HIGH** (footgun)                            |
| 4   | Two incompatible outbox wire-shapes coexist; already caused one confirmed silent-data-loss bug (hr-service payroll journals)                                 | MEDIUM                                        |
| 5   | BOM/WORK_CENTERS not gated in nav or backend by capability (same root cause as `05`'s blocker)                                                               | MEDIUM (frontend symptom of the `05` blocker) |
| 6   | No platform-wide `Idempotency-Key` convention                                                                                                                | MEDIUM                                        |
| 7   | Report "registry" is metadata-only; every report needs hand-written SQL                                                                                      | LOW-MEDIUM                                    |
| 8   | apiV2 versioning not fully uniform (2 of 17 upstreams)                                                                                                       | LOW / DOC-ONLY                                |
| 9   | Search entity extensibility needs source edits, not runtime config                                                                                           | LOW                                           |

## Confirmed correct, no gap

Transactional outbox (2 services, 2 patterns) · Kafka idempotency/dedup (atomic, shared, race-free) · non-destabilizing consumer dispatch for new event types · report-service tenant isolation · search-service tenant isolation (3-layer) · error-response shape consistency · API surface reusability pattern for new verticals.
