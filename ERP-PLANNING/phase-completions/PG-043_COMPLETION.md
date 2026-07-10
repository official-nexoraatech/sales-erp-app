# PG-043 — Bulk Employee/Attendance Import — Real Processing — Completion Report

**Date:** 2026-07-11
**Status:** Complete. Implementation was already present in the working tree (uncommitted,
likely from a concurrent session) when this session started — this pass verified it against
every item in the gap-prompt (`ERP-PLANNING/production-gap-prompts/008-HR/39-bulk-employee-attendance-import.md`)
rather than re-implementing it, then ran the test/typecheck gates the doc requires.

## Summary

`ImportEngine.ts`'s `employee` branch now really inserts into `employees` (department/designation
resolved by name, `employeeCode` generated sequentially per tenant when not supplied, PAN/bank
account encrypted via the exact `encryptField` + `createHmac('sha256', ...)` pair
`employee.routes.ts`'s single-create/update handlers already use). A new `attendance` entity type
was added end-to-end (schema, pre-fetch `employeeCode → employees.id` map,
`onConflictDoUpdate` keyed on `(tenantId, employeeId, attendanceDate)`, unresolved `employeeCode`
rows counted as **failed**, not silently skipped). `opening-stock`'s fallthrough was left
unimplemented on purpose, with an honest log line so it doesn't read as fixed by this pass.

hr-service's two stub `POST /employees/import` / `POST /attendance/import` endpoints (previously
fake `202 QUEUED` no-ops) are now thin proxies to scheduler-service's `/imports/*` endpoints —
`/attendance/import` additionally normalizes a raw biometric punch file
(`BiometricPunchNormalizer`, PG-041) into the `attendance` entity's CSV shape before handing it to
the same generic pipeline, so there is exactly one real execute path for each entity, not two.

`import.routes.ts` also picked up an `authenticate` preHandler on every route in this pass's
diff — those six routes had no authentication middleware at all before. That's a real,
unrelated-to-import-logic security fix bundled into the same diff; noting it here since it wasn't
called out as a task of this specific gap-prompt but is exactly the kind of gap this template's
security section would have flagged.

## Verification performed this session

- Read `ImportEngine.ts` in full (`execute()`'s employee/attendance/opening-stock branches,
  the department/designation/employeeCode pre-fetch maps, the `PERMISSIONS.EMPLOYEE_IMPORT`
  gate added specifically for the `employee` entity type on top of the generic
  `IMPORT_EXECUTE` check).
- Diffed `apps/hr-service/src/api/employee.routes.ts` and `attendance.routes.ts` against `HEAD`
  and confirmed the encryption call shape (`encryptField(value, encKey)` +
  `createHmac('sha256', encKey).update(value).digest('hex')`) is byte-for-byte identical between
  the single-create route and `ImportEngine`'s bulk branch — same ciphertext-recoverability,
  same lookup hash.
- Confirmed `importJobs.entityType` is `varchar(100)` (`packages/db-client/src/schema/scheduler.ts`),
  not a Postgres enum — no migration was needed to add `'attendance'`, matching the doc's own
  conditional note.
- Confirmed no generic Import wizard exists yet in `web-frontend` wired to
  `/imports/*` — per the doc's own instruction, building one is out of this package's scope;
  nothing was added to the frontend.
- `pnpm --filter scheduler-service test` — **65/65 passing** (16 in `ImportEngine.test.ts`,
  including the 3 new PG-043 describe blocks: employee insert w/ dept+designation+encrypted PAN,
  attendance insert w/ unresolved-code-as-failure, opening-stock-still-unimplemented regression).
- `pnpm --filter hr-service test` — 46/48 passing. The 2 failures
  (`holiday.test.ts` → 500 on create/seed) are in a file this pass's diff never touches
  (`holiday.routes.ts`/`holiday.test.ts` show no uncommitted changes) — pre-existing, unrelated
  to PG-043, not investigated further here.
- `pnpm --filter scheduler-service run type-check` and `pnpm --filter hr-service run type-check`
  — both clean.

## Known gap (not fixed — flagging per this template's convention)

The single-employee `POST /employees` route publishes an `EMPLOYEE_JOINED` event
(`ctx.events.publish('employee', created.id, 'EMPLOYEE_JOINED', ...)`) that other services
(e.g. search-service) consume to stay in sync. `ImportEngine.execute()`'s employee branch does
**not** publish this event for bulk-imported rows — bulk-imported employees are invisible to
search-service until a full reindex job runs. The doc's own Deliverables section flags this as a
"recommend: yes" rather than a hard Acceptance Criterion, and fixing it isn't a one-line change:
`ImportEngine` is constructed with a plain `ErpDatabase` (`packages/platform-sdk`'s
`PlatformEventBus` needs a `TenantScopedDatabase` plus `userId`/`correlationId` context that
`ImportEngine` doesn't currently receive), so wiring it in means either threading an event-bus
dependency through `ImportEngine`'s constructor (touching every call site) or having
`import.routes.ts` publish a summary event itself after `execute()` returns. Left as a follow-up;
same treatment PG-005 gave its search-service scope note.

## Deployment Checklist

- [x] None required — no schema migration (`entityType` is `varchar`, widened value needs no
      DDL), no new environment variables (`FIELD_ENCRYPTION_KEY` was already required by the
      existing PayrollEngine/employee-create paths), no new permission (`EMPLOYEE_IMPORT`
      already existed and is already granted appropriately per role-defaults). Checked off
      because this was verified this session, not because a step remains pending.
