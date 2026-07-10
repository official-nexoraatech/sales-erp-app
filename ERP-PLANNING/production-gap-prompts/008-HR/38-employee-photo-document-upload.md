# [PG-042] Employee Photo/Document Upload — Real Storage

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** HR
**Priority:** High
**Complexity:** S — the storage integration (`StorageClient` + `PlatformAttachments`) already exists and is proven in two other services; this is wiring, not building.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/hr-service (src/api/employee.routes.ts), packages/platform-sdk (storage.ts, attachments.ts)

---

## Overview

- **Business objective:** Employee records need a photo (ID badge, attendance-verification reference) and scanned documents (Aadhaar copy, PAN card, education certificates, offer letter) for statutory compliance and HR recordkeeping. Today these "upload" but nothing is ever stored — HR staff believe a document is on file when it silently isn't, which is a compliance gap discovered only when the document is actually needed (a labour inspection, a dispute, an audit).
- **Current implementation:** `apps/hr-service/src/api/employee.routes.ts` lines 353-372:
  ```ts
  fastify.post<{ Params: { id: string } }>('/employees/:id/photo/upload', ... async (request, reply) => {
    ...
    // Return a pre-signed URL placeholder; real S3 wiring via MinIO in production
    const uploadUrl = `/uploads/employees/${id}/photo`;
    return reply.code(200).send({ data: { uploadUrl, employeeId: id } });
  });

  fastify.post<{ Params: { id: string } }>('/employees/:id/documents/upload', ... async (request, reply) => {
    ...
    const uploadUrl = `/uploads/employees/${id}/documents`;
    return reply.code(200).send({ data: { uploadUrl, employeeId: id } });
  });
  ```
  Both endpoints verify the employee exists (tenant-scoped) and then return a hardcoded string that looks like a path but is never backed by any storage write, any DB row, or any file. The comment in the code (`// real S3 wiring via MinIO in production`) confirms this was a known, deliberate placeholder.
- **Current architecture:** `employees.photoUrl` (`packages/db-client/src/schema/hr.ts` line 103, `varchar(500)`) is the only DB column tied to this feature — it is never actually set by these two endpoints (nothing calls `.update(employees).set({ photoUrl: ... })` anywhere in `employee.routes.ts`). There is no `employee_documents` table at all — "documents" (plural, e.g. Aadhaar scan + PAN scan + certificates) has no data model.
- **Current limitations:** No real file bytes are ever received (the routes don't even read `request.file()`), no MinIO/S3 write happens, no `document_attachments` row is created, no download/view path exists for a previously "uploaded" document.

## Existing Code Analysis

- **What already exists and should be reused — this is the core finding of this package:** `packages/platform-sdk/src/storage.ts` (`StorageClient`, real `@aws-sdk/client-s3` + `getSignedUrl` against MinIO in dev / S3 in prod, `forcePathStyle: true` for MinIO) and `packages/platform-sdk/src/attachments.ts` (`PlatformAttachments` — tenant-scoped upload/list/get/getDownloadUrl/delete backed by the `document_attachments` table). This exact pair is **already live and proven** in `apps/purchase-service/src/api/attachment.routes.ts` and `apps/sales-service/src/api/attachment.routes.ts` — both real, working, permission-gated multipart upload endpoints. hr-service should be the third consumer of this same pair, not a fourth storage integration.
  - `document_attachments` schema (`packages/db-client/src/schema/document-attachments.ts`): generic `entityType` + `entityId` + `objectKey` + `fileName` + `fileSize` + `mimeType` + `uploadedBy`, tenant-scoped. `entityType: 'EMPLOYEE'` (or `'EMPLOYEE_PHOTO'` / `'EMPLOYEE_DOCUMENT'` if photo needs to stay a single canonical current record rather than an accumulating list — see Architecture below) fits without a schema change.
  - Purchase-service's `attachment.routes.ts` is the direct pattern reference: `ALLOWED_ENTITY_TYPES`, `ALLOWED_MIME_TYPES`, `MAX_FILE_SIZE = 10MB`, permission-per-entity-type map, `checkPermission()` used inline (not as a static preHandler) because the permission to check depends on a value only known after reading the multipart field.
  - hr-service's own field-level encryption pattern (`@erp/utils` `encryptField`/`decryptField`, already used for `panEncrypted`/`bankAccountNoEncrypted` in `PayrollEngine.ts` and presumably in `employee.routes.ts`'s create/update handlers — confirm exact call sites during implementation) is the precedent to check against for whether document *bytes* need equivalent protection.
- **What should never be modified:** `PlatformAttachments`/`StorageClient` themselves (shared, working, used by two other services — changing their behavior risks purchase-service/sales-service attachments) and the existing PAN/bank-account encryption logic in `PayrollEngine.ts`.
- **Prior related work:** None in `phase-completions/` specific to this. The pattern this package follows (generic attachments) was established for purchase-service GRN/PO attachments; no HR-specific completion doc references it.

## Architecture

- **Open question the plan must resolve, stated explicitly rather than silently decided:** should scanned documents (Aadhaar, PAN card images) get the same at-rest protection as the *data fields* `aadhaarLast4`/`panEncrypted`/`bankAccountNoEncrypted` already have? The schema comment (`hr.ts` line 66) says "Aadhaar: last 4 digits only — NEVER store full 12" — that policy exists because full Aadhaar numbers are sensitive personal data under India's Aadhaar Act. **A photo of the physical Aadhaar card exposes the same full 12-digit number as an image, defeating the last-4-only policy at the data-field level.** This package's recommendation: treat `entityType: 'EMPLOYEE_DOCUMENT'` uploads through `PlatformAttachments` as already reasonably protected — MinIO/S3 objects are not public by default (`getSignedUrl` with a 3600s expiry is the only read path; there is no unauthenticated object URL) — which is consistent treatment with how purchase-service/sales-service already treat GRN/PO attachments (also potentially sensitive: supplier bank details on an invoice scan). Do **not** add field-level AES encryption on top of the S3 object (no existing precedent for encrypting attachment bytes before upload in this codebase, and it would break `PlatformAttachments.getDownloadUrl()`'s redirect-to-signed-URL contract that both existing consumers rely on). Instead, mitigate the actual risk (full Aadhaar visible in an image) by adding upload-time client guidance ("upload Aadhaar with the middle 4 digits masked, or use the masked-Aadhaar e-download") — a policy/UX control, not a crypto one. Flag this as a security recommendation to confirm with the user/compliance owner before treating it as closed, per this template's own convention of surfacing tradeoffs rather than picking silently.
- Photo vs. documents distinction: **photo** is a single current value (`employees.photoUrl` already models "one photo, replace on re-upload") — keep that 1:1 shape, just make the upload real: store via `PlatformAttachments.upload()` with `entityType: 'EMPLOYEE_PHOTO'`, then `UPDATE employees SET photo_url = <signed URL or objectKey>`. **Store the `objectKey`, not a signed URL, in `photoUrl`** — signed URLs expire; the column should hold a stable reference and the read path (employee list/detail GET) should call `storage.getSignedUrl(objectKey)` at read time, matching how `PlatformAttachments.getDownloadUrl()` already works for other attachments. This requires updating `employee.routes.ts`'s `GET /employees` list handler (which currently `select`s `photoUrl` directly, line 196) to resolve it through the storage client instead of returning the raw column value.
- **Documents** are plural/accumulating (Aadhaar scan, PAN scan, offer letter, certificates) — use `PlatformAttachments.list('EMPLOYEE_DOCUMENT', employeeId)` for the list view, `.upload()` per file, `.delete()` per file — exactly the purchase-service GRN attachment pattern, just a different `entityType`.

## Database Changes

- **None** — `document_attachments` already exists and is generic enough (`entityType`/`entityId` already support adding `'EMPLOYEE_PHOTO'`/`'EMPLOYEE_DOCUMENT'` as new string values; no enum/check constraint currently restricts `entityType` to `PURCHASE_ORDER`/`GRN` at the DB level — confirm this during implementation, since if `document-attachments.ts` does have a Postgres-level check constraint, a migration to widen it is needed).
- `employees.photoUrl` column stays as-is (`varchar(500)`) but its semantic changes from "placeholder path string" to "MinIO/S3 object key" — no migration needed, existing rows are all `NULL` today (nothing has ever really populated it).

## Backend

- Rewrite `POST /employees/:id/photo/upload` and `POST /employees/:id/documents/upload` in `apps/hr-service/src/api/employee.routes.ts` to accept real multipart (`await request.file()`), matching purchase-service's `attachment.routes.ts` handler shape: validate MIME type (`image/jpeg`, `image/png` for photo; add `application/pdf` for documents), enforce `MAX_FILE_SIZE`, call `ctx.files.upload(...)` (requires hr-service's `PlatformContextFactory` to be constructed with a `StorageClient` — confirm hr-service's `main.ts`/context setup already wires `ctx.files`; if not, this package must add that wiring, following purchase-service's `main.ts` as the reference).
- New `GET /employees/:id/documents` — lists via `PlatformAttachments.list('EMPLOYEE_DOCUMENT', id)`, tenant-scoped, gated on `PERMISSIONS.EMPLOYEE_VIEW`.
- New `GET /employees/:id/documents/:attachmentId/download` and `DELETE /employees/:id/documents/:attachmentId` — same lookup-then-permission-check pattern as purchase-service's attachment routes (fetch the row via `PlatformAttachments.get()` first since ownership must be confirmed against `employeeId`, not just tenant, before returning a signed URL).
- `photoUrl` write: after successful upload, `UPDATE employees SET photo_url = :objectKey`; publish no new event (photo/document changes are not currently modeled as domain events elsewhere in HR — do not invent one speculatively).
- Audit: `ctx.audit.log({ action: 'UPDATE', entityType: 'employee', entityId: id, metadata: { action: 'PHOTO_UPLOAD' | 'DOCUMENT_UPLOAD', fileName } })` — matches the granularity already used for `EMPLOYEE_EXITED` in the same file (line 348).

## Frontend

- Employee detail page: replace whatever currently renders `photoUrl` as a raw `<img src>` (it would break once `photoUrl` becomes an objectKey, not a URL — confirm the frontend calls the download/signed-URL endpoint rather than rendering the column directly; if it currently does the latter, that is itself a bug this package must fix) with an `<img>` sourced from a resolved signed URL (fetched via a new `GET /employees/:id/photo` that redirects to the signed URL, mirroring purchase-service's `/attachments/:id/download` 302-redirect pattern).
- Documents tab: file upload dropzone + list with download/delete, gated on `PermissionGate` for `PERMISSIONS.EMPLOYEE_UPDATE` (upload/delete) and `PERMISSIONS.EMPLOYEE_VIEW` (view/download).

## API Contract

- `POST /employees/:id/photo/upload` — multipart `file` field → `200 { data: { employeeId, photoUrl: objectKey } }`. Errors: `404` unknown employee, `400` invalid MIME/size.
- `GET /employees/:id/photo` — `302` redirect to signed URL, or `404` if no photo set.
- `POST /employees/:id/documents/upload` — multipart `file` + `documentType` field (e.g. `AADHAAR`, `PAN`, `CERTIFICATE`, `OTHER`) → `201 { data: DocumentAttachmentRow }`.
- `GET /employees/:id/documents` → `200 { data: DocumentAttachmentRow[] }`.
- `GET /employees/:id/documents/:attachmentId/download` → `302` redirect.
- `DELETE /employees/:id/documents/:attachmentId` → `204`.

## Multi-Tenant Considerations

- `PlatformAttachments` already scopes every query by `this.db.tenantId` (see `attachments.ts` — `findOwned` filters on `tenantId`) — no new isolation logic needed, just correct `ctxFactory.create({ tenantId, ... })` usage, matching every other handler in this file.
- Additionally verify `entityId` (employeeId) belongs to the requesting tenant before allowing document list/download — `PlatformAttachments.get()` only checks the attachment row's own `tenantId`, not that the `entityId` employee itself belongs to this tenant. Since the employee existence check (`eq(employees.id, id), eq(employees.tenantId, tenantId)`) already happens for photo/document upload, apply the same check before the list/download/delete routes too — do not rely on the attachment row's tenant-scoping alone.

## Integration

- **hr-service**: owns the rewritten routes.
- **packages/platform-sdk**: consumed, not modified (`StorageClient`, `PlatformAttachments`).
- No other service touched — this is a self-contained hr-service change using an already-shared package.

## Coding Standards

- Multipart handling, MIME allow-listing, and the "look up the row to learn its permission-relevant field before checking permission" idiom must match `apps/purchase-service/src/api/attachment.routes.ts` exactly (same constants shape, same `assertPermission` helper pattern) — do not invent a new upload convention.
- `requirePermission` preHandler where the permission is statically known (list), inline `checkPermission()` where it depends on a runtime value (photo vs. document upload use different write permissions only if the product decides so — default recommendation: both use `PERMISSIONS.EMPLOYEE_UPDATE`, no split needed, so a static preHandler is sufficient here and the inline-check pattern from purchase-service is not actually required — simpler than that reference implementation because there's only one entity type, not two).

## Performance

- Not applicable at this scale — single-file uploads, no batching concern. Signed URL generation is a single S3 API call per read, consistent with existing attachment read paths.

## Security

- `requirePermission(PERMISSIONS.EMPLOYEE_UPDATE)` on upload/delete, `PERMISSIONS.EMPLOYEE_VIEW` on list/download — reusing existing constants, no new permission needed.
- MIME/size validation as described in Backend.
- The Aadhaar-image-exposure consideration described in Architecture is the one open item that should be confirmed with a product/compliance decision-maker rather than silently resolved by this plan.

## Testing

- Unit/integration: new `apps/hr-service/src/__tests__/employee-documents.test.ts` — upload succeeds and creates a `document_attachments` row with correct `entityType`/`entityId`/`tenantId`; download requires `EMPLOYEE_VIEW`; delete requires `EMPLOYEE_UPDATE`; cross-tenant employee ID returns 404 not the other tenant's document.
- Confirm existing purchase-service/sales-service attachment tests (`apps/purchase-service/src/__tests__/` — check for an `attachment` test file) are unaffected by this change (no shared code is modified, only consumed).

## Acceptance Criteria

- [ ] Uploading a photo via `POST /employees/:id/photo/upload` results in a real object in MinIO (verifiable via MinIO console or a follow-up `GET /employees/:id/photo` returning a working signed URL that serves the uploaded bytes).
- [ ] Uploading a document creates a real `document_attachments` row and a real S3 object; it appears in `GET /employees/:id/documents`.
- [ ] Deleting a document removes both the DB row and the S3 object (via `PlatformAttachments.delete()`, already implemented).
- [ ] A user without `EMPLOYEE_UPDATE` cannot upload; a user without `EMPLOYEE_VIEW` cannot list/download.
- [ ] `pnpm --filter hr-service test` passes.

## Deliverables

- **Files to create:** `apps/hr-service/src/__tests__/employee-documents.test.ts`.
- **Files to modify:** `apps/hr-service/src/api/employee.routes.ts` (rewrite the two stub routes, add list/download/delete routes, fix the `GET /employees` list handler's `photoUrl` exposure), hr-service's context/main.ts wiring if `ctx.files` (StorageClient) isn't already configured for this service.
- **Migrations:** none expected; confirm no `entityType` check constraint blocks new values, add a trivial migration only if one exists.
- **APIs added/changed:** `POST /employees/:id/photo/upload` (real), `GET /employees/:id/photo` (new), `POST /employees/:id/documents/upload` (real), `GET /employees/:id/documents` (new), `GET /employees/:id/documents/:attachmentId/download` (new), `DELETE /employees/:id/documents/:attachmentId` (new).
- **Events added/changed:** none.
- **Tests added:** `employee-documents.test.ts`.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/hr-service/src/api/employee.routes.ts` lines 353-372 contain two upload endpoints that verify the employee exists then return a hardcoded fake URL string (`/uploads/employees/${id}/photo`) — no file is ever received or stored. `employees.photoUrl` (varchar 500) exists in the schema but is never actually written by these routes.

**Current Objective:** Wire both endpoints to the already-working `PlatformAttachments`/`StorageClient` pair (`packages/platform-sdk`) that `purchase-service` and `sales-service` already use for real MinIO/S3-backed file storage — no new storage integration should be built.

**Architecture Snapshot:** `document_attachments` is a generic, tenant-scoped, entityType/entityId table already serving two services. `StorageClient` talks to MinIO in dev / S3 in prod via the AWS SDK, `forcePathStyle: true`. hr-service already has its own field-level AES encryption for PAN/bank-account *data fields* (via `@erp/utils` `encryptField`) and stores Aadhaar as last-4-only — this package must decide (and this file recommends, but flags as needing confirmation) whether uploaded *document images* need equivalent protection, since a photographed Aadhaar card exposes the full number the data-field policy deliberately avoids storing.

**Completed Components:** `PlatformAttachments`/`StorageClient` (working, used elsewhere). Employee CRUD, PT/PF/ESI/TDS payroll calc (working, untouched by this package).

**Pending Components:** This package does not address the biometric-import (PG-041) or bulk-import (PG-043) gaps — those are separate stub endpoints in the same file, unrelated to file storage.

**Known Constraints:** No API gateway; hr-service calls `packages/platform-sdk` directly as an in-process dependency, no network hop involved (unlike PG-041's scheduler-service call, which is cross-service).

**Coding Standards:** Match `apps/purchase-service/src/api/attachment.routes.ts` exactly for multipart handling, MIME allow-listing, and permission-check placement (static preHandler where possible, since employee photo/document doesn't have purchase-service's two-entity-type permission split).

**Reusable Components:** `PlatformAttachments` (upload/list/get/getDownloadUrl/delete), `StorageClient` (uploadFile/getSignedUrl/deleteFile) — both in `packages/platform-sdk/src`.

**APIs Already Available:** none new required from other services — this is entirely in-process within hr-service.

**Events Already Available:** not applicable — no event is published for photo/document changes today and none should be invented.

**Shared Utilities:** `@erp/logger`, `@erp/types` (`PERMISSIONS`, `NotFoundError`), `packages/platform-sdk` (`PlatformAttachments`, `StorageClient`).

**Feature Flags:** none.

**Multi-Tenant Rules:** every attachment query filters by `tenantId`; additionally verify the target employee itself belongs to the requesting tenant before any document operation (do not rely on the attachment row's own tenant-scoping alone, since `entityId` is just an integer with no FK enforcement).

**Security Rules:** `PERMISSIONS.EMPLOYEE_UPDATE` (upload/delete), `PERMISSIONS.EMPLOYEE_VIEW` (list/download).

**Database State:** no migration expected; `document_attachments` and `employees.photoUrl` already exist.

**Testing Status:** no tests exist for this feature today (untestable — it was a stub); this package adds the first real coverage.

**Next Session Plan:** single session.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/008-HR/38-employee-photo-document-upload.md` (PG-042). Read `apps/purchase-service/src/api/attachment.routes.ts` first as the reference pattern, then rewrite the two stub routes in `apps/hr-service/src/api/employee.routes.ts` (lines ~353-372) to use `PlatformAttachments`/`StorageClient` for real uploads. Before writing code, resolve the open question in this file's Architecture section (Aadhaar-image exposure) with the user rather than silently picking an answer."
