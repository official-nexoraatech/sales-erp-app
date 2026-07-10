# [PG-041] Biometric Attendance Import — Real Integration

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** HR
**Priority:** Medium
**Complexity:** L — vendor-agnostic ingestion adapter (parsing + reconciliation + shift-aware attendance mapping) plus a genuinely new upload/mapping UI; no biometric-hardware SDK integration itself is in scope, which keeps this from being XL.
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/hr-service (src/api/attendance.routes.ts, src/domain), packages/db-client (attendance schema)

---

## Overview

- **Business objective:** Indian SMB retail tenants running this ERP commonly already own a biometric attendance device (ESSL, Matrix COSEC, ZKTeco, Realtime are the common brands in this market segment) purchased independently of this ERP. Today, HR staff cannot get punch data out of that device into payroll — every day's attendance for every employee has to be re-keyed by hand via the manual mark/correction UI, which defeats the purpose of owning the hardware and is a real source of payroll errors (missed punches silently become "ABSENT").
- **Current implementation:** `apps/hr-service/src/api/attendance.routes.ts` line 237-239:
  ```ts
  fastify.post('/attendance/import', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (_request, reply) => {
    return reply.code(202).send({ data: { message: 'Biometric import queued', status: 'QUEUED' } });
  });
  ```
  The request body is never read (`_request`), nothing is parsed, no row is written anywhere, no job is actually queued. It is a pure no-op that returns a fake "accepted" response.
- **Current architecture:** `attendance.routes.ts` already has a real manual/shift-based path: `POST /attendance` (single mark, `MarkAttendanceSchema` with `source: 'MANUAL' | 'BIOMETRIC'` already in the enum — the schema anticipated this feature but the import endpoint was never wired to it), `POST /attendance/bulk-mark` (`BulkMarkSchema`, one date, many employees), and `PUT /attendance/:id/correct` (`CorrectAttendanceSchema`, with audit trail via `ctx.audit.log` and an `ATTENDANCE_CORRECTED` event). All three write to the `attendance` table (`packages/db-client` schema) and go through the same tenant-scoped `ctx.db`.
- **Current limitations:** No biometric vendor's export format is parsed. No mapping from a device's internal employee ID to this ERP's `employees.id`/`employeeCode` exists. No dedup/idempotency for re-importing the same day's punch file twice. No day-boundary/shift-aware conversion of raw first-punch/last-punch timestamps into `checkInTime`/`checkOutTime` + `status`.

## Existing Code Analysis

- **What already exists and should be reused:**
  - `MarkAttendanceSchema` in `attendance.routes.ts` already models a single day's attendance row with `source: z.enum(['MANUAL', 'BIOMETRIC'])` — the target write shape for imported rows is already defined, just never populated by anything but manual entry.
  - The shift/OT correction pipeline referenced in FEATURE_INVENTORY §5.7 ("manual/shift-based OT calc/correction with audit trail") — `shifts` table (imported in `attendance.routes.ts` line 3) already resolves an employee's expected shift window, which a raw punch-log import needs to compute late/half-day status consistently with manual entry.
  - `scheduler-service`'s generic `ImportEngine` (`apps/scheduler-service/src/domain/ImportEngine.ts`) — CSV parsing, per-entity Zod schema validation, batch execution, job-status polling (SSE), rollback-by-status — is the exact shape of pipeline a punch-log file needs (upload → map columns → validate → execute → status). See PG-043 (`008-HR/39-bulk-employee-attendance-import.md`) which is adding a real `attendance` entity type to this same engine for manual bulk backfill. **This package and PG-043 target the same underlying gap from two different entry points (biometric device export vs. manual bulk CSV) — they should share one `attendance` import-entity implementation in `ImportEngine`, not two.** Sequence PG-043's attendance-entity work first (or in the same session) and have this package's biometric adapter simply produce the same normalized CSV shape and post it through `POST /imports/upload` with `entityType: 'attendance'`, rather than building a second bespoke pipeline.
  - `employees.employeeCode` (unique per tenant, `packages/db-client/src/schema/hr.ts` line 117 `unique('employees_tenant_code')`) is the natural join key against a device's employee code/ID field — most biometric devices let you configure the "employee ID" field exported in punch logs to match an external code.
- **What should never be modified:** `POST /attendance` (manual single mark), `PUT /attendance/:id/correct` (correction with audit trail), and `GET /attendance/report` are working and out of scope — do not touch their logic, only reuse the same `attendance` table writes and event (`attendance.published('attendance', ..., 'ATTENDANCE_CORRECTED', ...)` pattern) for consistency.
- **Prior related work:** None found in `ERP-PLANNING/phase-completions/` — this is a first pass at the gap. FEATURE_INVENTORY.md §5.7 and §8 both describe it as a "no-op stub," confirmed accurate by direct read of `attendance.routes.ts` during this pass.

## Architecture

- Treat biometric import as a **file-format adapter in front of the existing generic import engine**, not a parallel attendance-write path:
  1. Device software (ESSL eTimeTrack, ZKTeco ZKTime, Matrix COSEC, etc.) exports a punch log — nearly universally either a CSV/TXT with columns like `EmployeeID, Name, Date, Time, Status/InOut` (one row per punch) or a proprietary `.dat` requiring the vendor's own export-to-CSV step done by the site admin (biometric devices push to on-prem software, not to this cloud ERP directly — treat this as **pull/upload of an exported file**, not a live device webhook, since none of these vendors expose a stable cloud webhook API in the SMB tier this ERP targets).
  2. A new **raw-punch normalization step** (`BiometricPunchNormalizer`, new file `apps/hr-service/src/domain/BiometricPunchNormalizer.ts`) parses the vendor-specific column layout (configurable per tenant — see Database Changes) into one row per (employeeCode, date) with computed `checkInTime` (earliest punch) / `checkOutTime` (latest punch) / raw punch count.
  3. The normalized rows are handed to `scheduler-service`'s `ImportEngine` `attendance` entity (added by PG-043) via `POST /imports/upload` with `entityType: 'attendance'`, `source: 'BIOMETRIC'` tagged on every row so downstream payroll/reporting can distinguish device-sourced attendance from manual entry.
  4. Existing `ImportEngine` job lifecycle (`UPLOADED → MAPPED → VALIDATED → EXECUTING → COMPLETED`) and SSE status polling apply unchanged.
  5. Shift-aware status derivation (PRESENT/HALF_DAY/LATE) reuses the same `shifts` lookup the manual correction path already does — do not reimplement late-arrival logic; extract it from `attendance.routes.ts`'s correction handler into a shared helper both paths call.
- Component/data flow: `Admin uploads punch-log file (web-frontend) → hr-service /attendance/import receives file, calls BiometricPunchNormalizer → normalized CSV handed to scheduler-service ImportEngine (entityType=attendance) → ImportEngine validates/executes → attendance rows inserted with source=BIOMETRIC → ATTENDANCE_CORRECTED-equivalent event published per row (batch summary event, not one per row, to avoid an event storm)`.

## Database Changes

- New table `biometric_device_configs` (tenant-scoped): `id, tenant_id, vendor ('ESSL'|'ZKTECO'|'MATRIX'|'REALTIME'|'GENERIC_CSV'), column_mapping jsonb (source column name -> {employeeCode, date, time, direction}), date_format varchar, created_by, created_at`. Lets a tenant configure their specific device's export layout once instead of re-mapping every upload.
- New column on `attendance`: none required — `source` already exists (`MarkAttendanceSchema` proves the column exists as `varchar` with a check constraint or enum covering `MANUAL`/`BIOMETRIC`; confirm the DB-level enum/check during implementation and widen it if it is currently DB-constrained to fewer values than the Zod schema allows).
- Migration: next sequential file in `packages/db-client/migrations/` (latest at time of writing is `0034_organization_theme_config.sql` — re-run `ls packages/db-client/migrations` before creating, since concurrent work may have added more). New migration creates `biometric_device_configs` with a `tenant_id` FK-less integer column (matching this repo's no-FK, app-enforced-isolation convention) and appropriate `unique(tenant_id)` if one config per tenant is the initial scope (multi-device-per-tenant is a reasonable v2, not v1).
- Rollback: drop `biometric_device_configs`; no destructive change to `attendance` itself (source enum widening, if needed, is additive).

## Backend

- `POST /hr/attendance-import/config` (new) — `requirePermission(PERMISSIONS.ATTENDANCE_MARK)` (reuse existing permission; do not invent a new one for a settings sub-screen of the same feature) — upserts a tenant's `biometric_device_configs` row.
- `GET /hr/attendance-import/config` — returns the tenant's current mapping (or `GENERIC_CSV` default: `EmployeeID,Date,Time,Direction`).
- `POST /attendance/import` — replace the current stub body. New behavior: accept multipart file upload (reuse the `@fastify/multipart` convention already used in `apps/purchase-service/src/api/attachment.routes.ts`), run `BiometricPunchNormalizer.parse(buffer, config)`, then call scheduler-service's import API (`POST /imports/upload` with `entityType: 'attendance'`) — either via direct HTTP call (this repo has no API gateway/service mesh yet per PG-001, so this is a direct service-to-service HTTP call, matching how other cross-service calls in this codebase are currently done) or, if hr-service and scheduler-service share the same Postgres and this is judged simpler and equally safe, hr-service can insert directly into `import_jobs` bypassing the HTTP hop — **prefer the direct DB insert only if `ImportEngine` is refactored to be importable as a class from both services' `@erp/db`-backed contexts; otherwise use the HTTP call to avoid duplicating job-state-machine logic in two services.**
- Response: `202 Accepted` with `{ jobId }` — now backed by a real job the caller can poll via the existing `GET /imports/:jobId/status` (SSE-capable) endpoint, instead of a response that means nothing.
- Idempotency: dedupe on `(tenantId, employeeCode, attendanceDate)` — an `onConflictDoUpdate` (last punch-log import for a given day wins) rather than `onConflictDoNothing`, since a corrected/re-exported punch log for the same day is a legitimate re-import scenario (unlike customer import which should skip dupes).
- Audit logging: one `ctx.audit.log` entry per import job (not per row) recording `{ jobId, rowCount, dateRange }` — matches the batch-level audit granularity already used for bulk-mark.

## Frontend

- New page/section under HR > Attendance: "Import Punch Log" — file upload, device-config editor (column mapping), and a job-status view reusing the existing generic Import UI component if `web-frontend` already has one wired for customer/supplier/item CSV import (check `web-frontend/src/pages` for an existing `ImportWizard`-style component before building a new one — if scheduler-service's generic import already has a frontend page, this feature should be a new `entityType` tab on that same page, not a separate HR-only import screen).
- Permission gating: `PermissionGate` on `PERMISSIONS.ATTENDANCE_MARK`.

## API Contract

- `POST /hr/attendance-import/config` — Body: `{ vendor: string, columnMapping: Record<string,string>, dateFormat: string }` → `201 { data: { id } }`.
- `GET /hr/attendance-import/config` → `200 { data: BiometricDeviceConfig | null }`.
- `POST /attendance/import` — multipart file field `file` → `202 { data: { jobId: string } }`. Errors: `422 IMPORT_EMPTY` (matches `ImportEngine`'s existing error code) if the parsed file yields zero rows; `400` on unparseable file format.
- Existing (reused, unchanged): `GET /imports/:jobId/status`, `POST /imports/:jobId/execute`, `POST /imports/:jobId/rollback`.

## Multi-Tenant Considerations

- `biometric_device_configs` scoped by `tenant_id`, one row per tenant (v1) — every query filters `eq(biometricDeviceConfigs.tenantId, tenantId)` per this repo's explicit-filter convention (no RLS).
- Employee-code matching must not cross tenant boundaries — `employees` lookups during normalization must include `tenantId` in the `WHERE`, exactly as every other employee query in `employee.routes.ts` does.

## Integration

- **hr-service**: owns the new config table and the `/attendance/import` endpoint rewrite.
- **scheduler-service**: receives the normalized rows via its `ImportEngine` (extended by PG-043 to support `entityType: 'attendance'`). This package depends on that entity type existing — sequence accordingly (see Depends on note above; formally "none" per the roadmap's dependency graph since both are Medium/High-priority Phase-4 leaves that can be built in either order, but the biometric adapter has no value until the attendance entity type exists in `ImportEngine`, so in practice do PG-043 first within the same execution window).
- **web-frontend**: new import UI surface (or extension of an existing generic import page).

## Coding Standards

- Fastify + Zod for the new config endpoints, `requirePermission` preHandler, `@erp/logger` for the normalizer's parse warnings (malformed rows should be logged and surfaced in the job's `validationErrors`, matching `ImportEngine.validate()`'s existing error-collection shape), no new HTTP client library — use whatever this repo already uses for service-to-service calls (check `packages/sdk` for an existing internal HTTP client helper before adding `axios`/`node-fetch` fresh).

## Performance

- Punch-log files can be large (a 100-employee site running 2 shifts for a month is ~6,000 rows) — reuse `ImportEngine`'s existing `BATCH_SIZE = 100` batching and 10,000-row cap; do not raise the cap for this feature without a specific justified need.
- Employee-code → `employees.id` resolution should be a single bulk `SELECT ... WHERE employeeCode IN (...)` per batch, not one query per row.

## Security

- `requirePermission(PERMISSIONS.ATTENDANCE_MARK)` on both the config and import endpoints — same permission already gating manual attendance marking, since biometric import is just another attendance-write path.
- File upload: enforce a max file size (reuse the `10 * 1024 * 1024` 10MB constant pattern from `purchase-service/src/api/attachment.routes.ts`) and an allow-list of MIME types (`text/csv`, `text/plain`).
- No new PII exposure — punch logs contain only employeeCode/timestamps, not the sensitive fields (`panEncrypted`, `bankAccountNoEncrypted`) that already have field-level encryption; no new encryption need here.

## Testing

- Unit: `apps/hr-service/src/__tests__/biometric-punch-normalizer.test.ts` (new) — covers ESSL-style, ZKTeco-style, and generic-CSV column layouts; multi-punch-per-day → single check-in/check-out collapse; malformed row handling.
- Integration: extend `apps/hr-service/src/__tests__/` (follow the existing `attendance`-adjacent test file naming, e.g. alongside `payroll-guard.test.ts`) — `POST /attendance/import` with a fixture CSV produces a job, job executes, `attendance` rows land with `source: 'BIOMETRIC'`.
- Regression: confirm `POST /attendance` (manual) and `PUT /attendance/:id/correct` are unaffected — no shared test fixtures should need changes.

## Acceptance Criteria

- [ ] `POST /attendance/import` with a valid ESSL/ZKTeco/generic-CSV punch-log file creates a real `import_jobs` row and, on execute, real `attendance` rows with `source: 'BIOMETRIC'`.
- [ ] Re-uploading the same day's punch log for the same employee updates (not duplicates) the existing row.
- [ ] A punch log referencing an unknown `employeeCode` surfaces as a validation error in the job's `validationErrors`, not a silent skip.
- [ ] Shift-based late/half-day status on imported rows matches what manual correction would compute for the same raw punch times.
- [ ] `pnpm --filter hr-service test` passes including new normalizer tests.

## Deliverables

- **Files to create:** `apps/hr-service/src/domain/BiometricPunchNormalizer.ts`, `apps/hr-service/src/api/attendance-import-config.routes.ts` (or added to `attendance.routes.ts` if small enough), `apps/hr-service/src/__tests__/biometric-punch-normalizer.test.ts`.
- **Files to modify:** `apps/hr-service/src/api/attendance.routes.ts` (replace the stub body of `POST /attendance/import`), `apps/scheduler-service/src/domain/ImportEngine.ts` (only if PG-043's attendance entity type isn't yet merged — otherwise just consume it).
- **Migrations:** one new migration adding `biometric_device_configs`.
- **APIs added/changed:** `POST /attendance/import` (behavior change, same signature), `POST|GET /hr/attendance-import/config` (new).
- **Events added/changed:** none new required; batch-level audit log entry per import.
- **Tests added:** normalizer unit tests, one integration test for the full upload→execute path.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/hr-service/src/api/attendance.routes.ts` has a fully working manual attendance path (`POST /attendance`, `PUT /attendance/:id/correct`, `GET /attendance/report`) but `POST /attendance/import` at line 237 is a hardcoded `202 { message: 'Biometric import queued', status: 'QUEUED' }` that reads no input and writes nothing.

**Current Objective:** Replace that stub with a real biometric-punch-log import path: parse a vendor-exported CSV/TXT punch log into normalized per-employee-per-day attendance rows and push them through the same generic import-job pipeline (`ImportEngine`) that other bulk imports use, rather than building a bespoke one-off pipeline.

**Architecture Snapshot:** No live device integration exists or is planned (SMB biometric hardware doesn't expose stable cloud webhooks) — this is file-upload-based. `scheduler-service`'s `ImportEngine` (CSV parse → Zod validate → batch execute → SSE status) is the reusable backbone; `attendance` entity type is being added there by a sibling package, PG-043. `attendance.source` column already models `MANUAL`/`BIOMETRIC` in the Zod schema.

**Completed Components:** Manual attendance mark/correct/report (working, do not touch). `ImportEngine`'s customer/supplier/item entity execution (working).

**Pending Components:** `ImportEngine`'s `attendance` entity execution is currently a no-op fallthrough (`imported += parsedBatch.length` with no actual insert) — see PG-043 for that fix, which this package depends on in practice.

**Known Constraints:** No API gateway exists yet (PG-001) — cross-service calls are direct HTTP or, if judged safer, direct shared-Postgres access via `@erp/db` from the calling service. No live device push/webhook — file upload only.

**Coding Standards:** Fastify + Zod, `requirePermission` preHandler, `@erp/logger`, reuse `ImportEngine`'s existing job-status/SSE pattern — see Coding Standards section above.

**Reusable Components:** `ImportEngine` (scheduler-service), `shifts` table + late/half-day derivation logic currently inline in `attendance.routes.ts`'s correction handler, `employees.employeeCode` as the join key.

**APIs Already Available:** `GET /imports/:jobId/status` (SSE-capable), `POST /imports/:jobId/execute`, `POST /imports/:jobId/rollback` — all in `apps/scheduler-service/src/api/import.routes.ts`.

**Events Already Available:** `ATTENDANCE_CORRECTED` (per-row) — this package should publish a batch-level equivalent, not reuse per-row.

**Shared Utilities:** `@erp/logger`, `@erp/types` (`PERMISSIONS`, `BusinessError`, `NotFoundError`).

**Feature Flags:** none required — this is core HR functionality, not gated.

**Multi-Tenant Rules:** every new table/query filters by `tenant_id` explicitly; no RLS in this codebase.

**Security Rules:** `PERMISSIONS.ATTENDANCE_MARK` on all new/changed endpoints.

**Database State:** depends on `attendance`, `employees`, `shifts` (existing) and a new `biometric_device_configs` table (this package).

**Testing Status:** attendance manual-path tests exist; no biometric-import tests exist yet (the endpoint is a stub, untestable beyond "returns 202").

**Next Session Plan:** single session, contingent on PG-043's `attendance` entity type landing first in `ImportEngine`.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/008-HR/37-biometric-attendance-import.md` (PG-041). Before starting, re-verify PG-043 (`008-HR/39-bulk-employee-attendance-import.md`) has landed a real `attendance` entity type in `apps/scheduler-service/src/domain/ImportEngine.ts` — if not, either do PG-043 first or build this package's normalizer to still push through `ImportEngine`'s existing job-status contract so PG-043 can slot in the actual insert logic later without changing this package's API surface."
