# [PG-043] Bulk Employee/Attendance Import — Real Processing

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order.

**Category:** HR
**Priority:** High
**Complexity:** M — the generic import pipeline already exists and already has partial `employee` schema wiring; the real work is finishing employee insert logic (sensitive-field handling) and adding a net-new `attendance` entity type end-to-end.
**Depends on:** none
**Blocks:** PG-041 (biometric attendance import) in practice — see that file's Depends-on note.
**Primary service(s)/package(s):** apps/scheduler-service (src/domain/ImportEngine.ts, src/api/import.routes.ts), apps/hr-service (src/api/employee.routes.ts, src/api/attendance.routes.ts)

---

## Overview

- **Business objective:** Onboarding a tenant with an existing workforce (10-200+ employees is typical for this ERP's SMB retail target) or backfilling a month of attendance requires bulk data entry. Re-keying every employee or every attendance row by hand through the single-record UI is impractical and error-prone, and — this is the specific finding of this pass — the two places a user might reasonably expect this to work (`hr-service`'s own `/employees/import` and `/attendance/import`, and `scheduler-service`'s generic import engine) **both silently fail to actually create records**, in two different ways described below.
- **Current implementation, finding #1 (hr-service's own stub endpoints):** `apps/hr-service/src/api/employee.routes.ts` line 374-376:
  ```ts
  fastify.post('/employees/import', { preHandler: [authenticate, requirePermission(PERMISSIONS.EMPLOYEE_IMPORT)] }, async (_request, reply) => {
    return reply.code(202).send({ data: { message: 'Import queued', status: 'QUEUED' } });
  });
  ```
  and `apps/hr-service/src/api/attendance.routes.ts` line 237-239 (same shape, see PG-041 for the attendance-side detail). Neither reads the request body, neither creates any job or row. These are dead-end endpoints.
- **Current implementation, finding #2 (scheduler-service's generic `ImportEngine` — a real, more subtle gap):** `apps/scheduler-service/src/domain/ImportEngine.ts` already declares `employee` as a first-class `ImportEntity` (line 24) with a real Zod validation schema (lines 52-58: `name, phone, designation, basicSalary, joiningDate`) and a real CSV template (`getTemplate()`, line 401). The full job lifecycle (`createJob` → `mapColumns` → `validate` → `execute`) runs against it and **validation genuinely works** — invalid employee rows are correctly rejected. But `execute()`'s actual insert branch (lines 339-342):
  ```ts
  } else {
    // employee and opening-stock are handled by dedicated services in Phase 3+
    imported += parsedBatch.length;
  }
  ```
  **silently counts every validated employee row as successfully imported without ever inserting anything into the `employees` table.** This is worse than an obvious stub — the job status ends as `COMPLETED` with `successRows` equal to the row count, giving the operator every signal that the import worked, when in fact zero employee records were created. There is no `attendance` entry in `ENTITY_SCHEMAS`/`ImportEntity` at all — attendance bulk import has no representation in this engine yet.
- **Current architecture:** `ImportEngine` is entity-agnostic infrastructure (job tracking via `importJobs` table, CSV parsing, column mapping, Zod validation, batched execution with per-batch try/catch, rollback-by-status-flip) already correctly wired end-to-end for `customer`/`supplier`/`item` (all three have real `insert(...)` calls in `execute()`). `employee`/`opening-stock` are the two entities left in the "Phase 3+" placeholder state.
- **Current limitations:** (a) hr-service's own import endpoints are unreachable dead ends disconnected from `ImportEngine` entirely; (b) `ImportEngine`'s `employee` entity validates but never persists; (c) `attendance` has no entity type in `ImportEngine` at all.

## Existing Code Analysis

- **What already exists and should be reused:** The entire `ImportEngine` job-lifecycle machinery (`apps/scheduler-service/src/domain/ImportEngine.ts`) — `parseCsv`, `applyTransform`, the `ENTITY_SCHEMAS` map, `createJob`/`mapColumns`/`validate`/`execute`/`rollback`/`getStatus`/`getTemplate`, and the atomic conditional-`UPDATE` claim-guard in `execute()` (the ES-26 comment at line 213-214: "if another call already claimed this job... we reject instead of double-executing" — this concurrency-safety pattern must be preserved for the new entity branches, not just copied loosely). The API surface in `apps/scheduler-service/src/api/import.routes.ts` (`/imports/upload`, `/map`, `/validate`, `/execute`, `/status` with SSE, `/rollback`, `/templates/:entityType`) is complete and entity-agnostic — no route changes needed, only `ImportEngine.ts` internals.
- **What should never be modified:** The `customer`/`supplier`/`item` insert branches in `execute()` (lines 276-338) — they work and are exercised by existing tests (`apps/scheduler-service/src/__tests__/ImportEngine.test.ts`); do not refactor their shape while adding the employee/attendance branches, to avoid an unrelated regression.
- **Prior related work:** None in `phase-completions/` specifically. The ES-26 comment inline in `ImportEngine.ts` (concurrency claim-guard) references a past pass but that work only hardened `execute()`'s claim logic, not entity coverage.

## Architecture

- **Employee entity — finish what's started, do not rebuild:** Extend `ENTITY_SCHEMAS.employee`'s Zod shape only as far as needed to create a valid `employees` row (current schema: `name, phone, designation, basicSalary, joiningDate` — missing `employeeCode` (required, unique per tenant — must be generated if not supplied, e.g. sequential `EMP-00042` per tenant, or accepted as an optional CSV column), `gender` (optional), `departmentId`/`designationId` (resolve by name the same way `execute()` already resolves `unit` name → `unitId` for items, lines 239-248 — pre-fetch a tenant's `departments`/`designations` name→id maps before the batch loop). Insert into `employees` with sane defaults for fields the CSV can't reasonably carry (`pfApplicable: true`, `esiApplicable: true`, `status: 'ACTIVE'`, `employmentType: 'FULL_TIME'` unless a column maps it).
  - **PAN/bank-account are optional CSV columns and, if present, must go through the same encryption path `employee.routes.ts`'s create handler already uses** (`@erp/utils` `encryptField` + HMAC hash for `panHash`/`bankAccountNoHash`) — do not insert them as plaintext into `panEncrypted`/`bankAccountNoEncrypted` just because the bulk path is a different code path from the single-create route. This is the one place this package must be careful not to introduce a real security regression by taking a shortcut the single-employee-create path doesn't take.
- **Attendance entity — genuinely new, model it on the shape PG-041's biometric import will also produce** (see `008-HR/37-biometric-attendance-import.md`, which depends on this entity type existing): schema `employeeCode, attendanceDate, status (PRESENT/ABSENT/HALF_DAY/LATE/HOLIDAY/WEEKLY_OFF), checkInTime?, checkOutTime?`. Resolve `employeeCode` → `employees.id` the same way item imports resolve `unit` name → `unitId`. Insert into `attendance` with `source: 'MANUAL'` for this entry point (PG-041's biometric adapter will tag its own rows `source: 'BIOMETRIC'` even though both flow through the same `attendance` entity type — pass `source` as a fixed value per import job, not a CSV column, since a single job is either "this is a manual backfill" or "this is a device export," not a mix).
- **hr-service's own stub endpoints — retire, don't duplicate:** `POST /employees/import` and `POST /attendance/import` in hr-service should either (a) be removed and the frontend pointed at `scheduler-service`'s generic `/imports/*` endpoints with the appropriate `entityType`, or (b) become thin proxies that call scheduler-service's `/imports/upload` with the file body and return the resulting `jobId`, if the frontend/routing convention makes a same-service endpoint preferable. **Do not implement a second, HR-local copy of CSV-parse-validate-execute logic** — that would recreate exactly the kind of duplicated, drifting logic this template's Enterprise Architecture Guidance warns against. Check `web-frontend` for which of the two URL shapes any existing (even if currently broken) import UI already calls before deciding (a) vs (b) — minimize frontend churn.

## Database Changes

- Not applicable — no schema change. `employees`, `departments`, `designations`, `attendance` all already exist with the columns needed. `importJobs.entityType` is a free-text/enum column (confirm exact DB type — if it's a Postgres enum type rather than `varchar`, adding `'attendance'` as a new `ImportEntity` value requires a migration to widen that enum; if it's `varchar`, no migration needed).

## Backend

- `apps/scheduler-service/src/domain/ImportEngine.ts`:
  - Add `'attendance'` to the `ImportEntity` union and `ENTITY_SCHEMAS`.
  - Replace the `employee`/`opening-stock` fallthrough (lines 339-342) with two real branches: a real `employee` insert (with department/designation resolution and encrypted-field handling as above) and, if `opening-stock` is out of scope for this package (it is — not named in this gap, and touching inventory valuation is a separate concern), leave `opening-stock` in the fallthrough **but change its comment and log line to be honest that it's still unimplemented**, rather than letting the fix for `employee` implicitly (and misleadingly) look like it also fixed `opening-stock`.
  - Add a real `attendance` insert branch.
  - Pre-fetch department/designation/employeeCode maps once per `execute()` call (outside the batch loop), mirroring the existing `unitNameToId` pattern.
  - Add the encryption calls (`encryptField`, HMAC hashing) for optional PAN/bank-account columns — import `@erp/utils`'s existing functions (same ones `PayrollEngine.ts` already imports) rather than re-implementing.
- `apps/hr-service/src/api/employee.routes.ts` and `attendance.routes.ts`: remove or reduce the two stub endpoints per the Architecture decision above.
- Validation: extend `ImportEngine.validate()`'s existing per-row Zod `safeParse` — no change to that function's shape, only to the schemas it validates against.
- Idempotency: `employee` import should probably use `onConflictDoNothing()` keyed on `(tenantId, employeeCode)` (matching the existing `unique('employees_tenant_code')` constraint) exactly like `customer`/`supplier` already do; `attendance` should use `onConflictDoUpdate` keyed on `(tenantId, employeeId, attendanceDate)` since re-importing a corrected day's attendance is a legitimate scenario (same reasoning as PG-041's normalizer output).

## Frontend

- If `web-frontend` already has a generic Import wizard page wired to scheduler-service's `/imports/*` endpoints for customer/supplier/item (check before building anything new), add `employee` and `attendance` as selectable entity types in that same wizard — do not build an HR-specific import screen. If no such generic wizard exists yet in the frontend at all (only the backend API does), building the first version of it is out of scope for this package — flag that gap back to whoever owns Import/Export UI and scope this package to the backend fix plus template/API correctness only.

## API Contract

- No route shape changes — `apps/scheduler-service/src/api/import.routes.ts`'s existing endpoints (`POST /imports/upload`, `/imports/:jobId/map`, `/imports/:jobId/validate`, `/imports/:jobId/execute`, `GET /imports/:jobId/status`, `POST /imports/:jobId/rollback`, `GET /imports/templates/:entityType`) already accept any `ImportEntity` value generically — adding `'attendance'` to `VALID_ENTITIES` in `import.routes.ts` (currently hardcoded array, line 20) is the only route-file change needed.
- hr-service: `POST /employees/import` and `POST /attendance/import` either removed (breaking change to a currently-fake endpoint — low risk, since it never worked) or turned into thin redirects/proxies to scheduler-service's endpoints, per the Architecture decision.

## Multi-Tenant Considerations

- `ImportEngine` already threads `tenantId` through every method — the new branches must do the same for every new table touched (`employees`, `departments`, `designations`, `attendance` lookups all need `eq(..., tenantId)`), matching the existing `customer`/`supplier`/`item` branches' convention exactly.

## Integration

- **scheduler-service**: owns the entity-type extension.
- **hr-service**: either removes or proxies its own stub endpoints — depends on the Architecture decision above; if proxying, this is a same-repo direct HTTP call from hr-service to scheduler-service (no gateway exists yet, per PG-001).
- **PG-041 (biometric attendance import)**: consumes the `attendance` entity type this package adds — sequence this package first within a shared execution window if both are being done close together.

## Coding Standards

- Match the existing `customer`/`supplier`/`item` branch style in `execute()` exactly — same batching (`BATCH_SIZE = 100`), same try/catch-per-batch-with-`failed +=` pattern, same `onConflictDoNothing()`/`onConflictDoUpdate()` idiom already used elsewhere in this codebase.
- Reuse `@erp/utils`'s `encryptField`/decrypt/hash helpers rather than reimplementing — these already exist and are tested via `apps/hr-service/src/__tests__/payroll-encryption.test.ts`.

## Performance

- No change to `ImportEngine`'s existing 10,000-row cap or 100-row batch size — employee/attendance imports are not expected to exceed the volumes customer/item imports already handle comfortably.
- Pre-fetch department/designation/employeeCode maps once per execute() call (not per row/batch) — same reasoning as the existing `unitNameToId` pre-fetch.

## Security

- The PAN/bank-account encryption-on-import requirement (Architecture section) is the one security-relevant change in this package — every other aspect reuses already-reviewed patterns.
- `requirePermission(PERMISSIONS.IMPORT_EXECUTE)` (already enforced generically by `import.routes.ts` for all entity types) covers the new `employee`/`attendance` entity types automatically — no new permission needed, but confirm `IMPORT_EXECUTE` is an appropriately senior permission for creating employee records with statutory/financial fields (PAN, bank account) — if the current permission model grants `IMPORT_EXECUTE` more broadly than `EMPLOYEE_CREATE`, that's a real RBAC gap to flag (see `PERMISSIONS.EMPLOYEE_CREATE`/`EMPLOYEE_IMPORT` — consider gating the `employee` entity type specifically on `EMPLOYEE_IMPORT` in addition to the generic `IMPORT_EXECUTE`, inside `ImportEngine.execute()` or `import.routes.ts`, rather than only the generic import permission).

## Testing

- Extend `apps/scheduler-service/src/__tests__/ImportEngine.test.ts` with: real `employee` insert assertions (row actually exists in `employees` after `execute()`, PAN encrypted correctly if supplied, `onConflictDoNothing` behavior on duplicate `employeeCode`), real `attendance` insert assertions (row exists, `employeeCode` correctly resolved to `employeeId`, unknown `employeeCode` surfaces as a failed row not a silent skip), and a regression test asserting `opening-stock` is still explicitly unimplemented (so a future change doesn't accidentally regress it further without anyone noticing, and so this package's own tests don't imply more was fixed than actually was).
- hr-service: remove/adjust any existing tests asserting the old stub 202 response, if such tests exist (`apps/hr-service/src/__tests__/permission-guards.test.ts` mentions `EMPLOYEE_IMPORT`/`ATTENDANCE_MARK` permission checks — confirm these test the permission gate, not the (fake) success response, before changing).

## Acceptance Criteria

- [ ] A valid employee CSV imported through `scheduler-service`'s `/imports/*` endpoints results in real rows in `employees` with correct department/designation resolution.
- [ ] An employee CSV row with a PAN number results in `panEncrypted`/`panHash` populated exactly as the single-employee-create route would populate them (same ciphertext-recoverability, same hash for lookup).
- [ ] A valid attendance CSV imported the same way results in real rows in `attendance`, correctly joined by `employeeCode`.
- [ ] An attendance row referencing an unknown `employeeCode` is reported as a validation/execution failure, not silently counted as imported.
- [ ] hr-service's `/employees/import` and `/attendance/import` no longer return a fake success with zero effect — they either 410/redirect to the real endpoints or proxy through to them.
- [ ] `pnpm --filter scheduler-service test` and `pnpm --filter hr-service test` both pass.

## Deliverables

- **Files to create:** none required beyond test files.
- **Files to modify:** `apps/scheduler-service/src/domain/ImportEngine.ts` (employee real-insert branch, new attendance entity + branch, department/designation/employeeCode pre-fetch maps), `apps/scheduler-service/src/api/import.routes.ts` (add `'attendance'` to `VALID_ENTITIES`), `apps/hr-service/src/api/employee.routes.ts` and `attendance.routes.ts` (remove or proxy the stub endpoints), `apps/scheduler-service/src/__tests__/ImportEngine.test.ts`.
- **Migrations:** none expected; verify `importJobs.entityType`'s DB type first (see Database Changes).
- **APIs added/changed:** `import.routes.ts`'s `VALID_ENTITIES` gains `'attendance'`; hr-service's two stub endpoints change behavior or are removed.
- **Events added/changed:** none required beyond whatever event(s) `employees`/`attendance` creation already triggers elsewhere in normal (non-bulk) creation flows — confirm whether the single-employee `POST /employees` route publishes an `EMPLOYEE_CREATED` event and, if so, whether bulk-imported employees should too (recommend: yes, for search-service/other consumers relying on that event to stay in sync — publish one event per imported row, or a summary event if per-row is judged too high-volume for a bulk import).
- **Tests added:** employee/attendance real-insert tests, opening-stock-still-unimplemented regression test.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** There are two disconnected, both-broken bulk-import paths for HR data. (1) `apps/hr-service/src/api/employee.routes.ts` and `attendance.routes.ts` each have a `POST .../import` stub that returns a fake `202 QUEUED` and does nothing. (2) `apps/scheduler-service/src/domain/ImportEngine.ts` is a real, working generic CSV-import engine (used correctly by `customer`/`supplier`/`item`) that already lists `employee` as a supported entity type with real validation — but its `execute()` method's insert branch for `employee` (and `opening-stock`) is a silent no-op: it increments the success counter without ever inserting a row. `attendance` has no entity type in this engine at all yet.

**Current Objective:** Make `ImportEngine`'s `employee` branch actually insert (with department/designation resolution and correct PAN/bank-account encryption matching the single-create route), add a genuinely new `attendance` entity type end-to-end, and retire or proxy hr-service's own disconnected stub endpoints so there is exactly one real bulk-import path for each entity.

**Architecture Snapshot:** `ImportEngine` job lifecycle: `UPLOADED → MAPPED → VALIDATED → EXECUTING → COMPLETED`, with an atomic conditional-UPDATE claim guard preventing double-execution (ES-26 hardening, do not weaken). Batches of 100 rows, 10,000-row cap, per-batch try/catch. `employees.employeeCode` is unique per tenant; `panEncrypted`/`bankAccountNoEncrypted` use `@erp/utils` AES encryption + HMAC lookup hashes, already used by `PayrollEngine.ts` and (presumably) the single-employee-create route in `employee.routes.ts` — confirm the exact call site before writing the bulk-import equivalent, to match it precisely rather than reinvent it.

**Completed Components:** `ImportEngine`'s `customer`/`supplier`/`item` branches (real, tested, working — do not touch).

**Pending Components:** PG-041 (biometric attendance import) depends on the `attendance` entity type this package adds — sequence accordingly. `opening-stock`'s own fallthrough-no-op is explicitly NOT fixed by this package (out of scope — a separate inventory-module concern); only its log/comment honesty is touched so it doesn't look retroactively fixed.

**Known Constraints:** No API gateway — any hr-service-to-scheduler-service proxy call is a direct HTTP call between services on their own ports.

**Coding Standards:** Match the existing `customer`/`supplier`/`item` `execute()` branches exactly in structure (batching, error handling, onConflict idiom).

**Reusable Components:** `ImportEngine`'s full job-lifecycle machinery; `@erp/utils` `encryptField`/hash helpers; the existing `unitNameToId` pre-fetch pattern as the template for department/designation/employeeCode pre-fetch maps.

**APIs Already Available:** `apps/scheduler-service/src/api/import.routes.ts`'s full route set — no new routes needed, only `VALID_ENTITIES` extended.

**Events Already Available:** whatever the single-employee `POST /employees` create route already publishes (confirm exact event name/topic during implementation) — extend bulk-import to publish the same, if appropriate.

**Shared Utilities:** `@erp/utils` (encryption/hash), `@erp/logger`, `@erp/types` (`BusinessError`, `NotFoundError`, `PERMISSIONS`).

**Feature Flags:** none.

**Multi-Tenant Rules:** every new lookup/insert filters by `tenantId`, matching every existing branch in `ImportEngine.execute()`.

**Security Rules:** `PERMISSIONS.IMPORT_EXECUTE` gates execution generically today; this package should evaluate (and, if warranted, add) a stricter check requiring `PERMISSIONS.EMPLOYEE_IMPORT` specifically for the `employee` entity type, since it can write sensitive statutory fields.

**Database State:** no migration expected unless `importJobs.entityType` turns out to be a restrictive Postgres enum rather than `varchar` — verify first.

**Testing Status:** `ImportEngine.test.ts` exists and covers `customer`/`supplier`/`item`; no employee/attendance coverage exists (untestable while it was a no-op).

**Next Session Plan:** single session; do this before or alongside PG-041 since PG-041 depends on the `attendance` entity type added here.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/008-HR/39-bulk-employee-attendance-import.md` (PG-043). Read `apps/scheduler-service/src/domain/ImportEngine.ts` in full first — note the `employee`/`opening-stock` fallthrough at the end of `execute()` (search for 'Phase 3+') is a silent false-success, not an obvious stub, so double check your fix actually results in DB rows, not just a passing-looking test. Confirm how the single-employee-create route in `apps/hr-service/src/api/employee.routes.ts` encrypts PAN/bank-account before writing the bulk-import equivalent, so both paths produce identical ciphertext/hash behavior."
