## Verification note (read this before implementing)

FEATURE_INVENTORY.md §8/§2 describes this as a generic "export job API — stub." The task brief for this package assumed it might live in `event-service`. Direct grep confirms it actually lives in **`apps/scheduler-service/src/api/export.routes.ts`**, registered in `apps/scheduler-service/src/main.ts:78` (`await exportRoutes(fastify, db)`), alongside the equally-real CSV-import wizard (`import.routes.ts`/`ImportEngine.ts`) it is the natural counterpart to. This file targets that real location.

# [PG-009] Export Job — Real File Generation

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Architecture
**Priority:** Critical
**Complexity:** M — no new infrastructure (MinIO/`StorageClient` and a real CSV/Excel formatter both already exist elsewhere in the codebase), but eight distinct entity-type queries must each be grounded in real tables and must respect existing tenant/permission scoping
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/scheduler-service (`api/export.routes.ts`, new `domain/ExportEngine.ts`), packages/platform-sdk (`storage.ts` — reused, not modified)

---

## Overview

- **Business objective:** the admin Import/Export tooling console lets an operator request an export of customers/suppliers/items/invoices/payments/ledger/stock/employees and immediately shows a "ready" download link. Today that link is fake — clicking it downloads a 2-line placeholder text file, not the requested data. Any workflow that depends on this (handing a supplier list to an accountant, backing up customer data before a bulk edit, auditing stock) silently fails while appearing to succeed, which is worse than an obvious error because nobody notices until they open the "exported" file.
- **Current implementation:** `apps/scheduler-service/src/api/export.routes.ts`. `POST /exports/generate` (lines 24-61): validates the request body against `ExportRequestSchema` (`entityType` enum of 8 values, `format` CSV/XLSX/PDF), inserts an `exportJobs` row with `status: 'PENDING'`, then **immediately** (no queueing, no actual data fetch) sets `signedUrl` to the literal string `` `/exports/${jobId}/download?token=placeholder` `` and flips status straight to `READY` — skipping the `GENERATING` status value that already exists in the schema's own enum (`packages/db-client/src/schema/scheduler.ts:90-93`, `.$type<'PENDING' | 'GENERATING' | 'READY' | 'FAILED' | 'EXPIRED'>()`) but is never actually used anywhere in the route. `GET /exports/:jobId/download` (lines 64-94): if the stored `signedUrl` contains the literal substring `'placeholder'`, it returns `200` with two lines of `# Export for ${entityType}` comment text instead of real data — the response is literally not the requested export, ever, for any entity type or format.
- **Current architecture:** `exportJobs` (`packages/db-client/src/schema/scheduler.ts:83-111`) already has an `s3Key: text('s3_key')` column that is declared but **never written to** by the current route — a strong signal the original schema author intended MinIO-backed storage from the start and the route implementation simply never got there. `StorageClient` (`packages/platform-sdk/src/storage.ts`) is a complete, working S3/MinIO client (`uploadFile`, `getSignedUrl`, `deleteFile`) already used in production by `PlatformAttachments` (`packages/platform-sdk/src/attachments.ts`) for document attachments and by `apps/tenant-service` for tenant logo/branding uploads. `ReportFormatter` (`apps/report-service/src/domain/ReportFormatter.ts`) is a complete, working CSV/Excel generator (`toCSV`, `toExcel` via the `xlsx` package, `getContentType`, `getFileName`) already used to generate real report exports in `report-service` — it is not directly importable from `scheduler-service` (separate deployable service), but its shape is the exact pattern to replicate.
- **Current limitations:** `GET /exports/:jobId/status` is the only one of the three routes that behaves honestly (it just reports whatever status is in the DB) — the dishonesty is entirely in `generate` (fakes completion instantly) and `download` (fakes content). There is no actual data-fetch step, no file-generation step, and no MinIO upload step anywhere in the file.

## Existing Code Analysis

- **What already exists and should be reused:** `StorageClient.uploadFile`/`.getSignedUrl` (`packages/platform-sdk/src/storage.ts`) — construct one `StorageClient` instance in `scheduler-service`'s `main.ts` using the same `MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`/`MINIO_BUCKET`/`MINIO_USE_SSL` env vars already defined in `.env.example:27-31` and already consumed by `apps/tenant-service/src/config.ts:25-28` — do not invent new env var names. The `xlsx` package (already a dependency of `report-service`, pinned to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` per `report-service/package.json:31` — add the identical dependency pin to `scheduler-service/package.json`, do not use a different xlsx version/source). `ImportEngine.ts`'s existing per-entity pattern (`ENTITY_SCHEMAS: Record<ImportEntity, ...>`, `apps/scheduler-service/src/domain/ImportEngine.ts:24-65`) as the structural template for a new `ExportEngine.ts` — mirror its shape (a `Record<ExportEntity, ...>` keyed lookup) rather than inventing a different per-entity dispatch pattern in the same service.
- **What should never be modified:** `GET /exports/:jobId/status` — already correct, leave as-is. `ExportRequestSchema`'s existing `entityType`/`format`/`filters` shape — the fix works within this existing contract, it does not need to change the request shape (only what happens after validation).
- **Prior related work:** none specific to export generation; the CSV import wizard (`ImportEngine.ts`, `import.routes.ts`) is the closest prior art in the same service and is the direct structural counterpart being completed here.

## Architecture

- **New `ExportEngine.ts`** in `apps/scheduler-service/src/domain/`, structurally mirroring `ImportEngine.ts`: a per-`entityType` query function returning rows + column definitions (label, key, type — same shape `ReportFormatter.toCSV`/`.toExcel` already expect, so the formatting half can be copied nearly verbatim rather than redesigned), for all 8 `ExportRequestSchema` entity types (`customer, supplier, item, invoice, payment, ledger, stock, employee`), each querying its authoritative table(s) directly via the shared `ErpDatabase` connection `scheduler-service` already holds (same cross-entity direct-DB-access pattern `ImportEngine.ts` already uses for `customers`/`suppliers`/`items`, confirmed by its existing imports) filtered by `tenantId` and any `filters` passed in the request (date range, status, etc. — entity-specific, validated loosely via the existing `z.record(z.unknown())` and interpreted per-entity inside `ExportEngine`, not re-validated at the route layer).
- **Generation pipeline** (replaces the current instant-fake-success block in `POST /exports/generate`): (1) insert `exportJobs` row with `status: 'PENDING'` (unchanged); (2) immediately flip to `GENERATING` (finally using the schema's existing-but-dead enum value) and enqueue the actual work asynchronously via `scheduler-service`'s existing `JobRegistry`/BullMQ (same infrastructure PG-008 wires up for projection rebuilds — register one more job, `export-generate`, `manualOnly: true` per the `JobConfig.manualOnly` addition from PG-008, or if PG-008 hasn't landed yet, add the flag as part of this package instead — whichever package implements first should add the field); (3) the job handler calls `ExportEngine`'s query for the requested `entityType`, formats via `toCSV`/`toExcel`-equivalent helpers (or a lightweight text/PDF path for `PDF` format — see note below), uploads the resulting buffer via `StorageClient.uploadFile(tenantId, 'exports', fileName, buffer, mimeType)`, stores the returned object key in `exportJobs.s3Key` (finally populating the column that already exists for this purpose), computes a real signed URL via `StorageClient.getSignedUrl(objectKey, 86400)` (24h, matching the existing `signedUrlExpiresAt` convention already computed in the route), and updates the row to `status: 'READY'` with the real `signedUrl`/`totalRows`/`completedAt`; on failure, `status: 'FAILED'` with `errorMessage` (existing column, unused today — same gap pattern as `GENERATING`).
- **`PDF` format handling:** `ExportRequestSchema.format` includes `'PDF'`, but no PDF-generation library exists in `scheduler-service` today, and none of the 8 entity types are naturally PDF-shaped tabular exports (PDF makes sense for a single invoice document, which already has its own real PDF path elsewhere — `report.routes.ts:59-63` in `report-service`, `Content-Type: application/pdf`). Scope this package to CSV/XLSX only for the generic entity export, and have `PDF` format requests for these 8 entity types return `400 { error: { code: 'FORMAT_NOT_SUPPORTED', message: 'PDF export is only available for individual documents (see report-service /reports/:id/pdf); use CSV or XLSX for bulk entity export' } }` rather than silently generating a fake PDF — this is a deliberate scope decision, not an oversight, and should be called out explicitly during implementation review since it narrows the existing `ExportRequestSchema` enum's effective behavior without narrowing the schema itself (schema stays permissive for forward-compatibility; the route enforces the current real limitation).
- **`GET /exports/:jobId/download`:** once `signedUrl` is real (no longer contains `'placeholder'`), the existing `reply.redirect(job.signedUrl, 302)` branch (line 87) already handles it correctly and needs no further change — this line was already written correctly in anticipation of the real implementation, it just never had a real URL to redirect to.

## Database Changes

- Not applicable — `exportJobs.s3Key`, `.signedUrl`, `.signedUrlExpiresAt`, `.status` (including the already-declared but unused `GENERATING`/`FAILED` values), `.errorMessage` (wait — verify `errorMessage` exists on `exportJobs`; if the column is missing, it is a small additive migration, one nullable `text` column, following this repo's sequential Drizzle migration numbering in `packages/db-client`, reversible by dropping the column).

## Backend

- **Files to create:** `apps/scheduler-service/src/domain/ExportEngine.ts` (per-entity query + column-definition map, mirroring `ImportEngine.ts`'s structure), `apps/scheduler-service/src/domain/ExportFormatter.ts` (CSV/XLSX generation, structurally copied from `report-service/src/domain/ReportFormatter.ts`'s `toCSV`/`toExcel` — duplicated rather than shared-packaged, same documented tradeoff as PG-008's stock-level query duplication, since `report-service` and `scheduler-service` are separate deployables and neither currently depends on the other), `apps/scheduler-service/src/jobs/exportGenerateJob.ts` (the `JobRegistry`-registered handler).
- **Files to modify:** `apps/scheduler-service/src/api/export.routes.ts` (rewrite `POST /exports/generate` to enqueue instead of fake-complete; `GET /download` unchanged aside from the placeholder check becoming permanently false in practice), `apps/scheduler-service/src/main.ts` (construct `StorageClient`, register the new job), `apps/scheduler-service/package.json` (add `xlsx` dependency, identical pin to `report-service`'s), `.env.example` (no new vars needed — `MINIO_*` already present globally).
- **Events/Kafka:** not applicable.
- **Validation, authorization:** unchanged — `PERMISSIONS.EXPORT_GENERATE`/`.EXPORT_VIEW` gates stay exactly as they are (`export.routes.ts:25-26, 65-66, 98-99`), already correctly checked via the existing `hasPermission()` helper.
- **Idempotency:** each export request creates a new `exportJobs` row (no dedup today, and none is needed — re-requesting the same export is a legitimate, cheap, idempotent-in-effect action since it just produces a fresh file); no change to this behavior.
- **Telemetry:** log `totalRows`/`durationMs`/`entityType` on completion via `@erp/logger`, matching the logging shape already used by `JobRegistry`'s own job-completion log (`JobRegistry.ts:66-68`).

## Frontend

- Not applicable — verify at implementation time whether the Import/Export console page already polls `GET /exports/:jobId/status` (mirroring the import wizard's existing polling UX) or currently assumes instant completion given the backend's current instant-fake-success behavior; if the latter, a small frontend change to poll status until `READY`/`FAILED` (instead of assuming immediate `READY`) is needed and should be scoped as a quick follow-up within this same package rather than a separate one, since the two must land together for the export flow to remain usable (a fully async backend behind a frontend that assumes synchronous completion would visibly regress the UX).

## API Contract

- `POST /exports/generate` (unchanged request/response shape) → `201 { data: { jobId, fileName, downloadUrl, expiresAt } }`, but `downloadUrl` now only resolves to real content once status reaches `READY` (previously instant; now asynchronous — callers must poll `GET /exports/:jobId/status` before treating `downloadUrl` as usable, matching the existing `202 { data: { status, message: 'Export not ready yet' } }` branch in `GET /download` that already exists for exactly this case, line 78-80).
- New error: `400 FORMAT_NOT_SUPPORTED` for `format: 'PDF'` on these 8 entity types (see Architecture).

## Multi-Tenant Considerations

- Every `ExportEngine` query filters by `tenantId` from `request.auth.tenantId` (never from the request body), matching the existing route's `and(eq(exportJobs.id, ...), eq(exportJobs.tenantId, tenantId))` scoping already present in `GET /download`/`GET /status` (lines 73, 106) — the new generation query path must apply the identical filter to every entity table it reads, with no exceptions, since this is the one part of the fix that touches real tenant data for the first time.

## Integration

- **scheduler-service only** for the generation/storage logic. **MinIO** (via `StorageClient`, shared infra already used by `tenant-service`/attachments) is the new integration point for this service specifically (it has none today). No other backend service's code changes.

## Coding Standards

- Reuses `StorageClient` from `@erp/sdk` unmodified, reuses the `MINIO_*` env var convention unmodified, reuses `JobRegistry` unmodified (aside from the shared `manualOnly` addition, see PG-008 cross-reference). The only novel-but-justified addition is `ExportFormatter.ts` duplicating `ReportFormatter`'s shape rather than sharing it — justified because the two services are independently deployable and neither currently has a dependency edge to the other; introducing one just for this would be a larger architectural change than this package's scope.

## Performance

- Export queries should be bounded by `filters` (date range, status) where the entity naturally supports it (invoices, payments, ledger) to avoid an unbounded full-table pull for large tenants — mirror the same "bounded window" discipline used in PG-008's dashboard-daily rebuild (90-day default). Uploads to MinIO are single-shot (`PutObjectCommand`, no multipart) which is fine at this codebase's expected export sizes (tenant-scoped CSV/XLSX, not full-database dumps).

## Security

- No new permission surface — `EXPORT_GENERATE`/`EXPORT_VIEW` already correctly gate the two routes. The generated signed URL is time-limited (24h, matching the existing `signedUrlExpiresAt` field already computed) and MinIO-object-key-scoped per tenant (`tenant/${tenantId}/exports/...`, via `StorageClient.uploadFile`'s existing tenant-prefixing convention, `storage.ts:39`) — no cross-tenant object-key guessing surface beyond what `PlatformAttachments` already accepts as its threat model.

## Testing

- New `apps/scheduler-service/src/__tests__/ExportEngine.test.ts`: each of the 8 entity-type queries returns correctly tenant-scoped, correctly shaped rows against a seeded dataset.
- New `apps/scheduler-service/src/__tests__/export-generate-job.test.ts`: the job handler produces a real CSV/XLSX buffer, uploads it (mock `StorageClient`), and updates `exportJobs` to `READY` with a real `s3Key`/`signedUrl`; a forced query failure results in `FAILED` with `errorMessage` populated.
- Update `apps/scheduler-service/src/api/export.routes.ts`'s route-level tests (check for an existing test file at implementation time — none was found in this pass, so this may be the first) to assert `POST /exports/generate` now returns `status: 'PENDING'`/`'GENERATING'` (not instant `'READY'`) and that `format: 'PDF'` returns `400 FORMAT_NOT_SUPPORTED`.
- Manual repro: `POST /exports/generate` with `entityType: 'customer'`, poll `GET /exports/:jobId/status` until `READY`, then `GET /exports/:jobId/download` and confirm the response is a real CSV of the tenant's actual customer rows, not the two-line placeholder comment.

## Acceptance Criteria

- [ ] `POST /exports/generate` no longer sets `status: 'READY'` synchronously within the request — it enqueues real work and returns `PENDING`/`GENERATING`.
- [ ] `exportJobs.s3Key` is populated with a real MinIO object key after a successful export.
- [ ] `GET /exports/:jobId/download` for a completed job redirects to (or streams) real tenant data matching the requested `entityType`, not placeholder comment text.
- [ ] `format: 'PDF'` for these 8 entity types returns `400 FORMAT_NOT_SUPPORTED` instead of fake success.
- [ ] `pnpm --filter @erp/scheduler-service test` passes, including new `ExportEngine`/job tests.
- [ ] The literal string `'placeholder'` no longer appears anywhere in `export.routes.ts`.

## Deliverables

- **Files to create:** `apps/scheduler-service/src/domain/ExportEngine.ts`, `apps/scheduler-service/src/domain/ExportFormatter.ts`, `apps/scheduler-service/src/jobs/exportGenerateJob.ts`, `apps/scheduler-service/src/__tests__/ExportEngine.test.ts`, `apps/scheduler-service/src/__tests__/export-generate-job.test.ts`.
- **Files to modify:** `apps/scheduler-service/src/api/export.routes.ts`, `apps/scheduler-service/src/main.ts`, `apps/scheduler-service/package.json`.
- **Migrations:** only if `exportJobs.errorMessage` is confirmed missing at implementation time (verify against current schema first — likely already present given the sibling `dlqItems`/`projectionMetadata` tables both have it).
- **APIs added/changed:** `POST /exports/generate` behavior (async instead of fake-instant), new `400 FORMAT_NOT_SUPPORTED` error case.
- **Events added/changed:** none.
- **Tests added:** `ExportEngine.test.ts`, `export-generate-job.test.ts`, updated route-level test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/scheduler-service/src/api/export.routes.ts`'s `POST /exports/generate` fakes instant success (sets `status: 'READY'` and a placeholder `signedUrl` with no real file ever generated), and `GET /exports/:jobId/download` returns two lines of comment text whenever the stored URL contains `'placeholder'` — which is always, today. The schema (`exportJobs`) already has an `s3Key` column that has never been written to, strongly suggesting MinIO-backed storage was the original intent. `StorageClient` (MinIO) and a real CSV/Excel formatter (`ReportFormatter`, in `report-service`) both already exist elsewhere in this codebase and are the patterns to replicate, not reinvent.

**Current Objective:** replace the fake generate/download behavior with a real pipeline: query the requested entity's authoritative table(s) tenant-scoped, format as CSV/XLSX (mirroring `ReportFormatter`'s shape), upload to MinIO via `StorageClient`, store the real object key/signed URL, and only then mark the job `READY` — executed asynchronously via `scheduler-service`'s existing `JobRegistry`/BullMQ so the HTTP request returns immediately with `PENDING`/`GENERATING`.

**Architecture Snapshot:** `exportJobs` (`packages/db-client/src/schema/scheduler.ts:83-111`) already has every column needed (`s3Key`, `signedUrl`, `signedUrlExpiresAt`, `status` enum including unused `GENERATING`/`FAILED`, `errorMessage`). `StorageClient` (`packages/platform-sdk/src/storage.ts`) and `MINIO_*` env vars (`.env.example:27-31`) are already used by `tenant-service`/`PlatformAttachments`. `ImportEngine.ts` (same service, `apps/scheduler-service/src/domain/`) is the direct structural sibling for a new `ExportEngine.ts`.

**Completed Components:** the CSV import wizard (upload→column-map→validate→execute→rollback, `ImportEngine.ts`/`import.routes.ts`) is fully real and is the counterpart this export path is completing to parity with.

**Pending Components:** PDF generation for bulk entity export is explicitly out of scope (routed to `400 FORMAT_NOT_SUPPORTED` — individual-document PDF export already exists in `report-service` and is untouched). Any frontend polling-UX gap (if the current UI assumes instant completion) should land in the same package, per the Frontend section's note, not be deferred.

**Known Constraints:** single shared Postgres, no RLS — every new entity query must filter by `tenantId` explicitly. `scheduler-service` and `report-service` are separate deployables with no dependency edge between them, hence the deliberate, documented duplication of the CSV/XLSX formatting logic rather than a shared package extraction.

**Coding Standards:** see Coding Standards section — reuses `StorageClient`, `MINIO_*` env convention, and `JobRegistry` exactly as built; the only new pattern is a duplicated (not shared) formatter, justified by the current lack of a cross-service dependency edge.

**Reusable Components:** `StorageClient.uploadFile`/`.getSignedUrl` (`@erp/sdk`), `ImportEngine.ts`'s per-entity dispatch structure (template, not code, to reuse), `ReportFormatter.toCSV`/`.toExcel` (`apps/report-service/src/domain/ReportFormatter.ts`, shape to replicate).

**APIs Already Available:** `GET /exports/:jobId/status` already works correctly and needs no change — the async pipeline this package adds relies on callers using it as designed.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/logger`, `@erp/db` (`exportJobs` plus every entity table the 8 export types read from — `customers`, `suppliers`, `items`, `invoices`, `payments`, `inventoryLedger`/ledger tables, `projectionStockLevel` or equivalent for "stock", employee tables).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** every export query must filter by `request.auth.tenantId`; MinIO object keys are already tenant-prefixed by `StorageClient.uploadFile`'s existing convention (`tenant/${tenantId}/...`).

**Security Rules:** `PERMISSIONS.EXPORT_GENERATE`/`.EXPORT_VIEW` already correctly gate both routes — unchanged by this package.

**Database State:** `exportJobs` table exists with all needed columns except possibly `errorMessage` (verify at implementation time) — no migration expected, but check before assuming.

**Testing Status:** zero tests exist for export generation today (nothing real to test). `ImportEngine.ts` has its own existing test coverage (`apps/scheduler-service/src/__tests__/ImportEngine.test.ts`) that is a useful structural reference for the new `ExportEngine.test.ts`.

**Next Session Plan:** single session — Complexity M reflects eight distinct entity queries plus the async-job wiring, not architectural novelty; if time-constrained, ship CSV for 2-3 highest-value entity types (customer, invoice, stock) first, with the remainder and XLSX as a same-session follow-on.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/001-Architecture/09-export-job-real-implementation.md` (PG-009). Before writing code, re-confirm via grep that `apps/scheduler-service/src/api/export.routes.ts` still fakes instant success and that `exportJobs.s3Key` is still unwritten — both are load-bearing assumptions. Build `ExportEngine.ts` (mirror `ImportEngine.ts`'s structure) and `ExportFormatter.ts` (mirror `report-service`'s `ReportFormatter.ts`), wire the `StorageClient`/MinIO upload, then the async job registration, then rewrite the route handlers, then tests. Check whether the Import/Export frontend page needs a polling-UX update in the same session."
