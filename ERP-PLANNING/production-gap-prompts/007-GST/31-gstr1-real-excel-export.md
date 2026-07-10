# [PG-038] GSTR-1 — Real Excel Export

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** GST
**Priority:** High
**Complexity:** S — one route, reuse an already-vendored library from another service, no schema change
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/gst-service (src/api/gstr1.routes.ts, src/domain/Gstr1Service.ts), reference pattern in apps/report-service (src/domain/ReportFormatter.ts)

---

## Overview

- **Business objective:** GSTR-1 is the monthly outward-supply return every registered dealer must file on the GST portal. Accountants and tax consultants expect to download it as a formatted, government-portal-compatible spreadsheet (one sheet per section — B2B, B2CS, CDNR, HSN, Doc summary) so they can review, hand-correct edge cases, and either re-key it into the GST portal's offline utility or hand it to a CA. Today, choosing "Excel" in the export UI silently returns a JSON blob labelled `EXCEL_DATA` instead of a file — there is no `.xlsx` a user can open in Excel/LibreOffice, no `Content-Disposition` download header, and no `Content-Type` spreadsheet MIME type. Any frontend or API consumer that trusts the "EXCEL" format name is misled.
- **Current implementation:** `apps/gst-service/src/api/gstr1.routes.ts`, `POST /gst/gstr1/export?period=YYYY-MM&format=JSON|EXCEL` (lines 46–113). The route computes real data via `Gstr1Service.compute()` and validates it via `Gstr1Service.validateBeforeExport()` — that part is genuine. But the `EXCEL` branch (lines 97–112) is:
  ```ts
  // Excel format — return JSON representation of what would be in Excel
  // (actual Excel generation requires a spreadsheet library; returning structured data for now)
  return reply.code(200).send({
    data: {
      period: q.data.period,
      format: 'EXCEL_DATA',
      sheets: { B2B: sections.b2b, B2CS: sections.b2cs, CDNR: sections.cdnr, HSN: sections.hsn.data, DOC: sections.doc },
      exportedAt: new Date().toISOString(),
    },
  });
  ```
  This is a `200 OK` JSON envelope (the same `{data:...}` shape the rest of the API uses), not a binary spreadsheet response — the comment in the code admits it directly.
- **Current architecture:** `gst-service` (port 3018) is a standalone Fastify service; `Gstr1Service.compute()` (apps/gst-service/src/domain/Gstr1Service.ts) already assembles the exact section shape needed (`Gstr1Section`: `b2b`, `b2cs`, `b2cl`, `cdnr`, `cdnur`, `exp`, `hsn.data`, `doc`) from the `gst_ledger` table (`packages/db-client/src/schema/gst.ts`). `Gstr1Service.toNicJson()` already builds the NIC-portal-compatible JSON for the `JSON` format branch — that branch is correct and out of scope here.
- **Current limitations:** no spreadsheet library is declared in `apps/gst-service/package.json` at all (confirmed by reading the file — dependencies are `@erp/config`, `@erp/db`, `@erp/logger`, `@erp/sdk`, `@erp/types`, `@erp/utils`, `fastify`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, `drizzle-orm`, `jose`, `kafkajs`, `ulid`, `zod` — no `xlsx`/`exceljs`/similar). `FEATURE_INVENTORY.md` §5.5 and §8 both independently confirm this: "GSTR-1 (…Excel export is a stub returning JSON)" and "GSTR-1 Excel export is a stub returning JSON under a different label."

## Existing Code Analysis

- **What already exists and should be reused:** `apps/report-service` already solved this exact problem for its own reports and the solution is directly reusable. `apps/report-service/package.json` declares `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"` (SheetJS Community Edition, pinned to a specific build via its own CDN tarball rather than the npm registry package — this is deliberate, not a typo, so gst-service must pin the identical tarball URL/version, not a different `xlsx` npm release). `apps/report-service/src/domain/ReportFormatter.ts` implements the exact pattern to copy: `toExcel(definition, result): Buffer` builds a workbook via `XLSX.utils.aoa_to_sheet()` (array-of-arrays → sheet), bolds the header row, sets `!cols` widths, appends an "Info" metadata sheet, and returns `XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })`. `getContentType('EXCEL')` returns `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; `getFileName(slug, 'EXCEL')` returns `${slug}-${YYYY-MM-DD}.xlsx`. The consuming route, `apps/report-service/src/api/analytics-reports.routes.ts` (lines 142–148), shows the exact Fastify reply pattern: `reply.header('Content-Type', ...).header('Content-Disposition', 'attachment; filename="..."').send(buf)`.
- **What should never be modified:** `Gstr1Service.compute()`, `Gstr1Service.toNicJson()`, and `Gstr1Service.validateBeforeExport()` are correct and must not change — this gap is purely about the response-serialization branch of the export route. The `JSON` format branch (lines 86–95) is out of scope and must keep returning the NIC JSON exactly as today. Do not touch `apps/report-service`'s `ReportFormatter` — gst-service needs its own small formatter, not a cross-service import of report-service's internal class (these are separate deployable services with no shared runtime dependency between them today, and introducing one would violate the "no cross-service transactional logic" architecture pattern this codebase otherwise uses only for events).
- **Prior related work:** no phase-completion report specifically touches this; `ERP-PLANNING/audit-phase-prompts/ES-10-GST-COMPLIANCE-CESS-RCM-GSTR9.md` is the phase that built GSTR-1/GSTR-3B/GSTR-9 originally (referenced by the `gst-engine.test.ts` header comment "ES-10 GST test suite") but did not close this specific stub — it was deferred, matching the FEATURE_INVENTORY.md finding.

## Architecture

- No new service, no new architectural pattern. Add a small `Gstr1ExcelFormatter` (or a static method on a new `apps/gst-service/src/domain/Gstr1ExcelFormatter.ts`) that takes a computed `Gstr1Section` and returns a `Buffer`, mirroring `ReportFormatter.toExcel()`'s structure but multi-sheet (one workbook, five sheets: B2B, B2CS, CDNR, HSN, DOC — matching the five keys already returned in the stub's `sheets` object) instead of report-service's single-sheet-plus-metadata layout, since GSTR-1 is inherently multi-section.
- Data flow: `POST /gst/gstr1/export?format=EXCEL` → `Gstr1Service.compute()` (unchanged) → `Gstr1Service.validateBeforeExport()` (unchanged, still blocks export on validation errors before any file is generated) → new `Gstr1ExcelFormatter.toWorkbook(sections)` → `Buffer` → `reply.header(...).send(buf)` instead of the current JSON envelope.

## Database Changes

Not applicable — no schema change. This is a serialization-layer fix only; `Gstr1Service.compute()`'s query against `gst_ledger` is unchanged.

## Backend

- **New file:** `apps/gst-service/src/domain/Gstr1ExcelFormatter.ts` — exports a class/module with `toWorkbook(sections: Gstr1Section): Buffer`, `getContentType(): string`, and `getFileName(period: string): string` (mirroring `ReportFormatter`'s three-method shape for consistency, even though gst-service only ever needs the `EXCEL` case — no `CSV`/`JSON` branch needed here since those are already handled elsewhere in the route). Internally: for each of the 5 sections (B2B, B2CS, CDNR, HSN, DOC), flatten the section's array of objects into an array-of-arrays with a header row (reuse the same `XLSX.utils.aoa_to_sheet()` + bold-header + `!cols` width pattern from `ReportFormatter.toExcel()`), `XLSX.utils.book_append_sheet(wb, ws, sheetName)` for each, `XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })` at the end. Column headers per sheet should reflect the real field names already in `Gstr1B2BEntry`/`Gstr1B2CSEntry`/`Gstr1HsnEntry` (e.g. B2B sheet: GSTIN, Receiver Name, Invoice Number, Invoice Date, Invoice Value, Place of Supply, Reverse Charge, Rate, Taxable Value, CGST, SGST, IGST, Cess).
- **Modify:** `apps/gst-service/src/api/gstr1.routes.ts`, the `EXCEL` branch of `POST /gst/gstr1/export` (lines 97–112) — replace the JSON stub with:
  ```ts
  const buf = Gstr1ExcelFormatter.toWorkbook(sections);
  return reply
    .header('Content-Type', Gstr1ExcelFormatter.getContentType())
    .header('Content-Disposition', `attachment; filename="${Gstr1ExcelFormatter.getFileName(q.data.period)}"`)
    .send(buf);
  ```
  Keep the existing `ctx.audit.log({ action: 'GSTR1_EXPORTED', ... })` call (line 79–84) unchanged and firing before both branches, as it does today.
- **Events/Kafka:** not applicable — this route does not publish events.
- **Validation, authorization:** unchanged — `authenticate` + `requirePermission(PERMISSIONS.GSTR1_FILE)` preHandler stays exactly as-is; `validateBeforeExport()` still throws `BusinessError('GSTR1_VALIDATION_FAILED', ...)` before any export (JSON or Excel) is generated, so a malformed GSTR-1 still cannot produce a file.
- **Error handling:** if `XLSX.write()` throws (malformed data — should not happen given `validateBeforeExport()` already ran, but defensively), let it propagate to the existing global error handler rather than adding a new try/catch — consistent with how every other gst-service route already relies on the shared Fastify error handler rather than local catches.

## Frontend

Not applicable — backend-only gap. No web-frontend GSTR-1 export page/button exists yet to point at this endpoint (verify at implementation time whether one exists under `apps/web-frontend/src/pages/gst/` and, if so, that it already treats the `EXCEL` response as a binary blob rather than JSON — if it currently parses the JSON stub, that call site needs its response handling updated to `blob()` + trigger-download, but that is a small follow-on, not new scope invented by this package).

## API Contract

- `POST /gst/gstr1/export?period=YYYY-MM&format=EXCEL` (body: `{ gstin?: string }`, permission `GSTR1_FILE`) — **changed response**: was `200 { data: { format: 'EXCEL_DATA', sheets: {...} } }` (JSON), now `200` with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="gstr1-2025-06.xlsx"`, and a binary `.xlsx` body.
- `POST /gst/gstr1/export?period=YYYY-MM&format=JSON` — unchanged, still returns `200 { data: { period, format: 'JSON', nicJson, exportedAt } }`.
- Error codes unchanged: `400 VALIDATION_ERROR` (bad period/gstin), `422`-equivalent `BusinessError('GSTR1_VALIDATION_FAILED', ...)` when `validateBeforeExport()` finds issues (thrown before either format branch).

## Multi-Tenant Considerations

- No change to tenant isolation — `Gstr1Service.compute(ctx.db, tenantId, period)` already scopes the query by `tenantId` via `TenantScopedDatabase`; the Excel formatter only serializes whatever `compute()` already returned for that tenant, it does not perform its own DB query.

## Integration

- **apps/gst-service** only. No other service calls this endpoint synchronously; no Kafka event is touched. `apps/web-frontend` may call it (see Frontend section) but that call site is a same-shape URL, not a new integration.

## Coding Standards

- Reuses the exact `xlsx` (SheetJS) dependency and `aoa_to_sheet`/`book_append_sheet`/`XLSX.write` API already vendored in `apps/report-service` — this package must pin the identical tarball URL (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) in `apps/gst-service/package.json`, not add a second spreadsheet library (`exceljs` or similar) and not pull a different `xlsx` version, per the master roadmap's "no package should introduce a second way to do any of these" rule.
- Follows this repo's existing Fastify + Zod route convention unchanged; no new middleware pattern introduced.

## Performance

- A single-tenant, single-month GSTR-1 export is bounded by that tenant's monthly invoice volume (already paginated implicitly by period filter in `Gstr1Service.compute()`); building an in-memory workbook for one month of one tenant's data is not a scale concern at this codebase's data volumes (same conclusion `ReportFormatter.toExcel()` already reached for full financial reports, which are typically larger than one GST period). No caching needed — exports are on-demand and infrequent (monthly).

## Security

- No new attack surface: the route already requires `GSTR1_FILE` permission and tenant-scoped data; the only change is the response body's encoding. Ensure the `Content-Disposition` filename is built from the already-validated `period` regex (`/^\d{4}-\d{2}$/`), not from unsanitized user input, to avoid header injection via filename (the existing `q.data.period` is already regex-validated before this point, so this is satisfied by construction — no extra escaping needed beyond what already exists).

## Testing

- New test file `apps/gst-service/src/__tests__/gstr1-excel-export.test.ts`: assert `Gstr1ExcelFormatter.toWorkbook()` returns a `Buffer` whose first bytes match the ZIP/xlsx magic number (`PK`), assert `XLSX.read()` on the returned buffer parses back 5 sheets named `B2B`, `B2CS`, `CDNR`, `HSN`, `DOC`, and assert row counts match the input section arrays' lengths (+1 for header row).
- Update/extend `apps/gst-service/src/__tests__/gst-engine.test.ts` or add a route-level test asserting `POST /gst/gstr1/export?format=EXCEL` responds with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and a non-JSON body (i.e. `reply.headers['content-type']` is the spreadsheet MIME type, not `application/json`).
- Manual repro: `curl -X POST "http://localhost:3018/gst/gstr1/export?period=2025-06&format=EXCEL" -H "Authorization: Bearer <token>" -o gstr1.xlsx` then open `gstr1.xlsx` in Excel/LibreOffice and confirm 5 populated sheets.

## Acceptance Criteria

- [ ] `POST /gst/gstr1/export?format=EXCEL` returns a binary `.xlsx` file (verified by opening it in a spreadsheet application), not a JSON body.
- [ ] Response has `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="gstr1-<period>.xlsx"`.
- [ ] The workbook contains 5 sheets (B2B, B2CS, CDNR, HSN, DOC) with header rows and data matching what `Gstr1Service.compute()` returned for that period.
- [ ] `format=JSON` behavior is byte-for-byte unchanged from before this change.
- [ ] `pnpm --filter @erp/gst-service type-check` and `pnpm --filter @erp/gst-service test` pass.
- [ ] `apps/gst-service/package.json` declares the identical `xlsx` tarball version as `apps/report-service/package.json` — no second spreadsheet library added.

## Deliverables

- **Files to create:** `apps/gst-service/src/domain/Gstr1ExcelFormatter.ts`, `apps/gst-service/src/__tests__/gstr1-excel-export.test.ts`.
- **Files to modify:** `apps/gst-service/src/api/gstr1.routes.ts` (EXCEL branch of `POST /gst/gstr1/export`), `apps/gst-service/package.json` (add `xlsx` dependency, same tarball as report-service).
- **Migrations:** none.
- **APIs added/changed:** `POST /gst/gstr1/export?format=EXCEL` response body/headers changed (JSON → binary xlsx); `format=JSON` unchanged.
- **Events added/changed:** none.
- **Tests added:** `gstr1-excel-export.test.ts`.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `Gstr1Service` (apps/gst-service/src/domain/Gstr1Service.ts) already correctly computes all GSTR-1 sections (B2B/B2CS/B2CL/CDNR/CDNUR/EXP/HSN/DOC) from the `gst_ledger` table and already builds a correct NIC-portal JSON export via `toNicJson()`. The only broken piece is the `EXCEL` format branch of `POST /gst/gstr1/export` in `apps/gst-service/src/api/gstr1.routes.ts`, which returns a JSON envelope labelled `EXCEL_DATA` instead of a real spreadsheet — the code's own comment admits this ("actual Excel generation requires a spreadsheet library; returning structured data for now").

**Current Objective:** make the `EXCEL` format branch return a genuine `.xlsx` binary, using the same `xlsx` (SheetJS) library `apps/report-service` already depends on (`ReportFormatter.toExcel()` is the pattern to copy), without touching the correct `JSON`/NIC-export branch or `Gstr1Service`'s computation logic.

**Architecture Snapshot:** gst-service is a standalone Fastify service (port 3018) with its own Postgres access via `TenantScopedDatabase`; it does not call report-service or share its runtime — the spreadsheet library must be vendored independently in `apps/gst-service/package.json`, pinned to the same tarball version report-service uses.

**Completed Components:** `Gstr1Service.compute()`, `Gstr1Service.toNicJson()`, `Gstr1Service.validateBeforeExport()` — all correct, do not modify.

**Pending Components:** none beyond this package's own scope — this is a self-contained, S-complexity fix.

**Known Constraints:** dev-phase, no live data concerns (per project memory, free to iterate); no live DB availability cannot block this package since it requires no migration.

**Coding Standards:** see Coding Standards section above — reuse `xlsx`/SheetJS exactly as report-service uses it; do not add `exceljs` or a different `xlsx` version.

**Reusable Components:** `apps/report-service/src/domain/ReportFormatter.ts`'s `toExcel()`/`getContentType()`/`getFileName()` methods as the structural pattern (not imported directly — copy the pattern into a new gst-service-local formatter, since these are separate deployables).

**APIs Already Available:** `Gstr1Service.compute(db, tenantId, period)` returns the exact section data to serialize; no new query needed.

**Events Already Available:** not applicable.

**Shared Utilities:** `@erp/logger` for any logging inside the new formatter (match `Gstr1Service`'s existing `createLogger({ serviceName: 'gst-service' })` pattern if logging is added).

**Feature Flags:** not applicable.

**Multi-Tenant Rules:** no change — tenant scoping happens upstream in `Gstr1Service.compute()`, the formatter only serializes already-tenant-scoped data.

**Security Rules:** route already requires `PERMISSIONS.GSTR1_FILE`; no change to authorization needed.

**Database State:** no migration required.

**Testing Status:** zero tests currently cover the export route's format branching; new tests listed in Deliverables.

**Next Session Plan:** single session — this is an S-complexity, single-file-plus-one-formatter change.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/007-GST/31-gstr1-real-excel-export.md` (PG-038). Read `apps/gst-service/src/api/gstr1.routes.ts` lines 46–113 and `apps/report-service/src/domain/ReportFormatter.ts` first — copy the `xlsx`/SheetJS pattern from the latter into a new `apps/gst-service/src/domain/Gstr1ExcelFormatter.ts`, then replace the `EXCEL` branch's JSON stub in `gstr1.routes.ts` with a real binary response. Do not touch the `JSON` branch or `Gstr1Service`'s computation methods."
