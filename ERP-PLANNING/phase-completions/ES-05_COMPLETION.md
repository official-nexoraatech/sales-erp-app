# ES-05 Completion Report — Report Tenant Isolation & Core Financial Reports
**Date:** 2026-07-02
**Status:** COMPLETE

## Summary
Audited all 69 raw SQL queries in `ReportEngine.ts` — every one already had correct `WHERE tenant_id = ${tid}` filters. Added `// ✓ tenant_id filtered — ES-05 audit` annotation above each query using `replace_all`. Added two new financial reports end-to-end: **AR Aging Summary** (`ar-aging`) and **AP Aging Summary** (`ap-aging`), including backend engine cases, registry definitions, dedicated GET API routes, and dedicated frontend pages with filter bar, ERPDataGrid with footer totals, and CSV export. All 94 unit tests pass, both services build clean.

## Tenant Isolation Audit Results
- Total queries audited: 69
- Queries already correct: 69 (100%)
- Queries that needed tenant_id fix: 0
- All annotated with `// ✓ tenant_id filtered — ES-05 audit`

## Files Changed
| File | Change |
|------|--------|
| `apps/report-service/src/domain/ReportEngine.ts` | Added audit comments to all 69 queries + 2 new cases (ar-aging, ap-aging) |
| `apps/report-service/src/domain/ReportRegistry.ts` | Added ar-aging + ap-aging definitions |
| `apps/report-service/src/api/analytics-reports.routes.ts` | Added GET /api/v1/reports/ar-aging and /api/v1/reports/ap-aging |
| `apps/web-frontend/src/api/endpoints.ts` | Added `AgingRow`, `AgingResponse` types + `arAgingApi` + `apAgingApi` |
| `apps/web-frontend/src/pages/reports/ArAgingPage.tsx` | NEW |
| `apps/web-frontend/src/pages/reports/ApAgingPage.tsx` | NEW |
| `apps/web-frontend/src/App.tsx` | Added lazy imports + routes for /reports/ar-aging and /reports/ap-aging |

## Tests Added
| File | Tests | Coverage |
|------|-------|----------|
| `apps/report-service/src/__tests__/report-tenant-isolation.test.ts` | 73 | All 69 existing slugs + 2 new aging reports + 2 isolation assertions |
| `apps/report-service/src/__tests__/ar-aging.test.ts` | 6 | asOf param, today default, row mapping, empty rows, tenant isolation, branchId filter |
| `apps/report-service/src/__tests__/ap-aging.test.ts` | 6 | Same scenarios for supplier/GRN side |

## Test Results
`pnpm test --filter @erp/report-service`: **94 PASSED** (4 test files)
`pnpm --filter @erp/report-service build`: **PASS** (tsc clean)
`pnpm --filter @erp/web-frontend build`: **PASS** (tsc --noEmit clean)

## Verification Results
- [x] ALL 69 queries in `ReportEngine.ts` annotated with `// ✓ tenant_id filtered — ES-05 audit`
- [x] Zero queries with missing tenant_id filter (audit confirmed)
- [x] `ar-aging` slug executes correctly via `POST /api/v2/reports/ar-aging/run`
- [x] `ap-aging` slug executes correctly via `POST /api/v2/reports/ap-aging/run`
- [x] `GET /api/v1/reports/ar-aging?asOf=2026-07-01` dedicated endpoint added
- [x] `GET /api/v1/reports/ap-aging` dedicated endpoint added
- [x] No-auth → 401 (via `authenticate` preHandler)
- [x] No `REPORT_VIEW` → 403 (via `requirePermission('REPORT_VIEW')` preHandler)
- [x] `ArAgingPage.tsx` registered at `/reports/ar-aging`
- [x] `ApAgingPage.tsx` registered at `/reports/ap-aging`
- [x] Filter bar: as-of date picker auto-refetches via `useQuery` key change
- [x] Export CSV button generates downloadable file
- [x] Footer row with column totals rendered via `ERPDataGrid` `footer` prop
- [x] Dark mode: all Tailwind classes use CSS variable tokens (dark mode compatible)
- [x] Both pages appear before `:slug` wildcard in router (correct precedence)
- [x] Existing `/reports/:slug` viewer still works for all 69+ other reports

## AR Aging SQL — Bucket Logic
```
days0to30: invoice_date within 0–30 days of asOf, outstanding > 0
days31to60: 31–60 days overdue
days61to90: 61–90 days overdue
days90plus: > 90 days overdue
total_outstanding: SUM of all outstanding per customer
Filters: tenant_id = $tid, invoice_date ≤ asOf, status NOT IN ('CANCELLED','DRAFT'), outstanding > 0
```

## AP Aging SQL — Bucket Logic
```
Same structure as AR Aging but against grns (GRNs = supplier purchase bills)
Supplier filter available via supplierId param
Filters: tenant_id = $tid, grn_date ≤ asOf, status NOT IN ('CANCELLED'), outstanding > 0
```

## Issues Found During Audit
None. All 69 pre-existing queries in `ReportEngine.ts` correctly scoped by `tenant_id`. The multi-UNION queries (`customer-ledger`, `customer-statement`, `supplier-ledger`, `gst-register`, `gstr3b-report`, `gst-payable-report`) each include `tenant_id` in every UNION branch.

## Phases Unblocked
ES-17 (needs AR/AP Aging as foundation)
