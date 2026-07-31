# Saga Monitor Admin Feature — Production-Readiness Audit

**Scope:** `apps/event-service/src/sagas` + `apps/event-service/src/api/saga.routes.ts` + `packages/platform-sdk/src/saga.ts` (orchestration engine) and `apps/web-frontend/src/pages/admin/distributed/SagaMonitorPage.tsx` (admin UI).
**Method:** Fresh ground-up audit — read the orchestration engine and UI source, then live-verified every claim against the running stack (gateway :3000, event-service :3023, tenant 2 "QA E2E Test Co") via direct API calls with a real bearer token, including creating and confirming a brand-new invoice (#132) to watch a saga run live.
**Date:** 2026-07-25

---

## Summary

"Distributed saga orchestration" in this codebase is, in reality, **one saga type with real production traffic** (`INVOICE_CREATION`, 66 rows as of this audit — all `COMPLETED` or `COMPENSATED`, live-verified) plus **one saga type that has scaffolding but has never run once** (`GST_COMPLIANCE_SAGA_TYPE`, 0 rows). Nothing else exists: a full-codebase grep for `SagaOrchestrator` usage and saga-type constants turns up exactly these two types, in exactly three places (`sales-service/InvoiceService.ts`, `gst-service/GstComplianceSaga.ts`, `event-service/sagas/gstComplianceProxy.ts`). Cross-service, multi-step flows that would be natural saga candidates — PO→GRN→Payment, tenant provisioning — are not implemented as sagas at all; they run as independent Kafka-consumer/outbox writes per service (consistent with this repo's known "no cross-service transactional logic" architecture gap). So the registry-based orchestrator is a real, well-built piece of infrastructure that is almost entirely unused — one proof-of-concept call site, wrapping an operation ( `InvoiceService.confirmInTransaction`) that is **already atomic via a single Postgres transaction**, meaning the "saga" adds observability/retry scaffolding but has no actual multi-step compensation to perform in practice.

On top of that thin backend, the admin monitoring UI has a **class of bug this audit did not expect going in**: the page's list view is not merely "retry doesn't work" (the known gap) — it **never shows any saga data at all**, for any tenant, regardless of how much real data exists, because of a response-shape mismatch between `apiClient` (which already unwraps `{data: ...}`) and the page's own code (which additionally expects a nonexistent `.content` wrapper). This was confirmed by reading both sides of the contract and cross-checking against a live API response. The retry/compensate gap described in the Event Service audit is real too, and turned out to be _more specific_ than "not registered" — retry is unreachable for the one saga type that has real data for a more basic reason (see Bug 3), and even when the code does reach the registration check, the failure mode is a clean, typed error (`SAGA_TYPE_NOT_REGISTERED`, HTTP-mapped), not a silent no-op.

**Net effect:** the backend data (list, summary, live saga tracking) is correct and updates in near-real-time — verified by creating invoice #132 and watching saga id 67 appear via the API within the same request/response cycle. But the UI that's supposed to surface this to an admin is non-functional for its primary purpose (viewing sagas), so operationally nobody using only the web UI would ever see the 66 real saga rows, let alone act on them.

---

## What Works (verified live)

1. **Backend list/summary/detail APIs are correct and tenant-scoped.** `GET /api/v2/admin/sagas`, `/summary`, and `/:id` all query `saga_log` filtered by `tenant_id = request.auth.tenantId`, live-verified with real data (66 `INVOICE_CREATION` rows: 60 `COMPLETED`, 6 `COMPENSATED`).
2. **End-to-end live saga tracking genuinely works at the API layer.** Created draft invoice #132 (`POST /api/sales/invoices`), confirmed it (`POST /api/sales/invoices/132/confirm`), and the very next `GET /api/v2/admin/sagas` call showed a brand-new row (`id: 67`, `sagaType: INVOICE_CREATION`, `status: COMPLETED`, full step history with real timestamps, ~91ms duration) and the summary counters (`completedLast24h`, `byType` count) incremented immediately. No polling delay, no async lag — this part of the pipeline is production-quality.
3. **Step-history detail is real and accurate**, including compensated cases — e.g. a real `COMPENSATED` row shows `stepHistory: [{name: "confirmInvoiceTransaction", status: "FAILED", error: "Item 44 has only 0 units available", ...}]`, matching the actual failure cause.
4. **RBAC is correctly wired and enforced.** `SAGA_VIEW`/`SAGA_MANAGE` are real, distinct permission constants (not a dead/wrong-constant bug — checked against the known recurring "dead-permission-constant" pattern in this codebase, and this one is clean). Route + nav + page all reference the same constant. Migration `0036` grants view-only to `ACCOUNTANT`/`ACCOUNTANT_SUPERVISOR`/`AUDITOR` and full manage to `OWNER`/`ADMIN`/`SUPER_ADMIN`, live-confirmed via JWT decode. A cross-tenant `PLATFORM_OPERATOR` account with no `SAGA_VIEW` grant got a clean `403 FORBIDDEN` — no leak.
5. **Tenant isolation is structurally sound at the query layer** — every route and `SagaOrchestrator.loadSaga()` filters by `tenantId`, so even if the UI/ID bugs below were fixed, no cross-tenant saga data could leak through this API.
6. **Retry/compensate failure modes are clean, not silent**, when they do fire — see Bugs 3/4 below for exact codes and HTTP statuses. An admin calling these APIs gets an explicit JSON error, never a false "success" toast for a no-op.

---

## Bugs / Gaps Found

### Bug 1 — CRITICAL — Saga list is permanently empty in the UI regardless of real data

**File:** `apps/web-frontend/src/pages/admin/distributed/SagaMonitorPage.tsx:67`

```ts
const sagas: SagaItem[] = ((listData as Record<string, unknown>)?.content as SagaItem[]) ?? [];
```

**Evidence:** `apiClient.get()` (`apps/web-frontend/src/api/client.ts:197`) already unwraps the backend envelope and returns `data.data`. The backend's `GET /admin/sagas` (`apps/event-service/src/api/saga.routes.ts:120`) returns `{ data: rows, meta: {...} }`, so `sagaAdminApi.list()` resolves to the raw **array** of rows directly (live-verified — `curl .../admin/sagas` returns `{"data":[{...},{...}],"meta":{...}}`). The page then reads `.content` off that array, which is `undefined` on every call, so `sagas` is unconditionally `[]`.
**Failure mode:** Silent — no error is thrown or logged; the page just renders the "No sagas found" empty state every time, indistinguishable from a tenant that genuinely has zero sagas.
**Business impact:** The entire Saga Monitor list — the primary purpose of the page — has never worked for any tenant with real saga data. All 66 real `INVOICE_CREATION` sagas (60 completed, 6 compensated) are invisible through the UI. An admin investigating a customer complaint about a failed sale (e.g. "Item 44 has only 0 units available", which genuinely happened and is in the data) has no UI path to find it.
**Severity:** Critical.

### Bug 2 — HIGH — Saga summary tiles show wrong (always-zero/blank) counts due to field-name mismatch

**Files:** `apps/web-frontend/src/pages/admin/distributed/SagaMonitorPage.tsx:16-22` (interface) vs `apps/event-service/src/api/saga.routes.ts:68-76` (response).
Backend returns `{ byStatus, byType, stalled, completedLast24h, avgDurationMs }`; the frontend's `SagaSummary` interface and rendering code read `statusCounts`, `typeCounts`, `stalledCount` — none of which exist in the real payload (live-verified: `{"data":{"byStatus":{"COMPENSATED":6,"COMPLETED":60},"byType":[...],"stalled":0,"completedLast24h":7,"avgDurationMs":84}}`).

- `summary.statusCounts?.['FAILED'] ?? 0` and `?.['STARTED'] ?? 0` → always render `0` regardless of the real `byStatus` counts (currently masked because there happen to be 0 real `FAILED`/`STARTED` rows, but this would silently hide real failures/in-progress sagas the moment one occurs).
- `summary.stalledCount` (STALLED tile, line 113) has **no `?? 0` fallback** — renders blank instead of `0` or the real `stalled` count.
- `completedLast24h` and `avgDurationMs` happen to be named identically on both sides, so those two tiles are correct (confirmed: value went `6→7` immediately after my live invoice-confirm test).
  **Severity:** High (silently wrong operational dashboard — 3 of 5 summary tiles are non-functional; would mask a real incident since FAILED always reads 0).

### Bug 3 — HIGH — Retry is not just "unregistered," it's unreachable for the only saga type with real data, and the two IDs the UI passes around are inconsistent with what the backend expects

**Files:** `packages/platform-sdk/src/saga.ts:91-100`, `apps/web-frontend/src/pages/admin/distributed/SagaMonitorPage.tsx:69-70,180-181,266`

- `SagaOrchestrator.retry()` first requires `status === 'FAILED' || status === 'COMPENSATING'` (line 93-95) before it ever checks whether a step factory is registered. Live-verified: calling retry on a real `COMPENSATED` saga returns a clean `422 INVALID_SAGA_STATE — "Cannot retry saga in status: COMPENSATED"`.
- Because `InvoiceService.confirm()`'s single step is `RETRYABLE` (not `IRREVERSIBLE`) and always has zero prior succeeded steps when it fails, every real-world `INVOICE_CREATION` failure lands directly in `COMPENSATED` — **never** `FAILED` or `COMPENSATING`. Confirmed against all 66 live rows: `byStatus` only ever contains `COMPLETED`/`COMPENSATED`, never `FAILED`/`COMPENSATING`/`STARTED`. That means the `SAGA_TYPE_NOT_REGISTERED` gap the Event Service audit found is real but is a **second, deeper layer** behind a status guard that already rejects retry for 100% of real `INVOICE_CREATION` sagas today, independent of registration. The UI's own retry button (`['FAILED','COMPENSATING'].includes(status)`, line 261) also never renders for any of the 66 real rows, so this is currently unreachable through the UI even before Bug 1 is considered.
- **Separately, and more surprising:** the frontend passes `selectedSaga.id` to `sagaAdminApi.retry(id)`/`.compensate(id)`, but `saga.id` is the row's bigserial primary key (a plain number, e.g. `62`), not the ULID `sagaId` the backend actually looks up by (`eq(sagaLog.sagaId, id)`). Live-verified: `POST /admin/sagas/62/retry` (numeric id, what the UI sends) → clean `404 NOT_FOUND — "Saga not found" {entity: "Saga", id: "62"}`, even though saga 62 genuinely exists. This is a distinct bug from the registration gap — it would misdirect _any_ admin into believing the saga record itself vanished, when the real saga is sitting right there under a different identifier field. (Also latent: `SagaItem.id` is typed `string` in the frontend interface but the real value is a JSON number — `saga.id.substring(0, 12)` at line 169 would throw a `TypeError` at render time if Bug 1 didn't keep the list permanently empty first.)
  **Severity:** High. Two independent, stacked defects (status-guard-before-registration-check, and wrong ID field) both make retry a dead feature for the one saga type that matters, on top of the already-known registration gap.

### Bug 4 — MEDIUM — Manual "Compensate" is gated on a status (`STARTED`) that structurally cannot persist for the real saga type, and the orchestrator's `compensate()` has no status guard at all

**Files:** `apps/web-frontend/src/pages/admin/distributed/SagaMonitorPage.tsx:271`, `packages/platform-sdk/src/saga.ts:117-135`

- The UI only shows the "Compensate" button for `status === 'STARTED'` (line 271). `InvoiceService.confirm()`'s saga has exactly one step, executed synchronously inside the HTTP request; by the time any client could observe it, it has already resolved to `COMPLETED` or `COMPENSATED`. Live-verified: 0 of 66 real rows are `STARTED` (nor could they realistically be, absent a mid-step process crash). So the manual-compensate button is, like retry, never actionable for real data.
- `SagaOrchestrator.compensate()` (unlike `retry()`) has **no status check whatsoever** — it will attempt to compensate a saga in any status, including `COMPLETED`. Live-verified: `POST /admin/sagas/<real COMPLETED sagaId>/compensate` reached the factory-lookup step and failed only with `SAGA_TYPE_NOT_REGISTERED` (not an earlier state-validation error) — meaning if `INVOICE_CREATION` ever _does_ get a step factory registered in a future fix, an admin could call compensate on an already-`COMPLETED`, successfully-invoiced sale with no guard stopping them. This is a design gap independent of the current registration gap, currently masked by it.
  **Severity:** Medium (currently unreachable via the UI's own status gating and the registration gap, but a real latent design flaw that would become exploitable the moment either is fixed without also adding a status guard to `compensate()`).

### Bug 5 — LOW — No other saga types exist; "distributed saga architecture" is one call site deep

Full-codebase grep for `SagaOrchestrator`/saga-type constants finds exactly 2 types (`INVOICE_CREATION`, `GST_COMPLIANCE_SAGA_TYPE`) across exactly 3 registration/run call sites. `GST_COMPLIANCE_SAGA_TYPE` has 0 real rows — confirmed live (`byType` only ever lists `INVOICE_CREATION`). Cross-service flows that are natural saga candidates (PO→GRN→Payment, tenant provisioning) are not implemented via this orchestrator at all; they use independent Kafka-consumer/outbox writes per service, consistent with this repo's known architectural gap around cross-service transactional consistency. Not a "bug" per se, but material for readiness scoring/framing: the saga engine is well-engineered infrastructure supporting essentially a single proof-of-concept usage.
**Severity:** Low / informational (architecture framing, not a defect).

### Bug 6 — LOW — No pagination controls despite a paginated backend

The page never passes `page`/`size` to `sagaAdminApi.list()`, so it's implicitly capped at the backend default of 50 rows per page with 66 real rows already in the table (`meta.totalPages: 22` at size 3 in my test calls; at the real default size 50 it would be 2 pages) and no way to reach page 2 from the UI. Currently moot because of Bug 1 (list is always empty anyway), but a real gap once that's fixed.
**Severity:** Low.

---

## Retry Failure-Mode Characterization (as requested)

All tested failure paths are **clean, typed, visible errors** — never a silent no-op:

| Action     | Input                                                      | HTTP      | Code                       | Message                                                                         |
| ---------- | ---------------------------------------------------------- | --------- | -------------------------- | ------------------------------------------------------------------------------- |
| Retry      | real `sagaId`, status `COMPENSATED`                        | 422       | `INVALID_SAGA_STATE`       | "Cannot retry saga in status: COMPENSATED"                                      |
| Retry      | numeric `id` (what the UI actually sends)                  | 404       | `NOT_FOUND`                | "Saga not found" (misleading — saga exists)                                     |
| Compensate | real `sagaId`, status `COMPLETED`, no status guard in code | 400-class | `SAGA_TYPE_NOT_REGISTERED` | "No step factory registered for saga type \"INVOICE_CREATION\" in this process" |

None of these look like success to the caller — the UI's `onError` handlers would fire and show a "Retry failed"/"Compensate failed" toast. The danger is not a silent no-op; it's that the errors, while individually clean, would be **confusing/misleading to an operator** (a 404 "Saga not found" for a saga that demonstrably exists, because of the wrong-ID bug) and that the feature is unreachable in the first place because of Bug 1.

---

## Readiness Score: 22/100

**Justification:**

- Backend orchestration engine (`packages/platform-sdk/src/saga.ts`) is well-written, tenant-safe, and its one real production usage (`INVOICE_CREATION`) has been live-verified end-to-end including a fresh invoice I created during this audit. That alone would justify a moderate score for the _engine_.
- But the deliverable being scored is the **admin monitoring/management feature**, and on that basis: the primary view (saga list) is completely non-functional for every tenant (Bug 1, Critical), the dashboard tiles are 60% wrong (Bug 2, High), and both mutating actions (retry, compensate) are dead for the only saga type with real data, via two independent stacked defects on top of the already-known registration gap (Bugs 3-4, High/Medium). An admin today gets zero operational value from this page — they cannot even see that 66 sagas exist, let alone act on the 6 compensated ones.
- Scope of "saga orchestration" as an architectural pattern is also extremely thin (Bug 5) — one proof-of-concept saga wrapping an already-atomic transaction, one type that's never run.
- Score reflects: real, correct, live-verified data pipeline underneath (some credit) + a monitoring UI that is fundamentally broken for its core purpose (heavy deduction) + a management capability that is currently a hard dead end for the one saga type that matters (heavy deduction).

---

## Files Referenced

- `apps/web-frontend/src/pages/admin/distributed/SagaMonitorPage.tsx`
- `apps/web-frontend/src/api/endpoints.ts` (`sagaAdminApi`, ~line 2022)
- `apps/web-frontend/src/api/client.ts` (`request()`/`apiClient.get`, ~line 110-201)
- `apps/event-service/src/api/saga.routes.ts`
- `apps/event-service/src/sagas/gstComplianceProxy.ts`
- `apps/event-service/src/main.ts` (~line 73, 134 — orchestrator wiring)
- `packages/platform-sdk/src/saga.ts` (`SagaOrchestrator`)
- `apps/sales-service/src/domain/InvoiceService.ts` (~line 403-450, `confirm()`)
- `apps/gst-service/src/domain/GstComplianceSaga.ts`
- `packages/db-client/migrations/0036_dlq_saga_permission_granularity_backfill.sql` (RBAC grants)
- `packages/db-client/{drizzle-schema.ts,src/schema/index.ts}` (`sagaLog` table — `id` bigserial vs `sagaId` varchar)
