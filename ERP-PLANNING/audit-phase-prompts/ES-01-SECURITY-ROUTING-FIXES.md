# ES-01 — Critical Security & Routing Fixes
## STATUS: ✅ COMPLETED
## Completed: 2026-07-02

---

## What Was Fixed in This Phase

This phase is **already done**. This file exists only so later Claude sessions know what changed.

### Changes Made

| File | Change |
|------|--------|
| `apps/search-service/src/middleware/authenticate.ts` | **NEW** — RS256 JWT middleware (jose library) |
| `apps/search-service/src/api/search.routes.ts` | Added `preHandler: [authenticate]` to all 7 routes |
| `apps/search-service/package.json` | Added `"jose": "^5.9.6"` dependency |
| `.env` | `LOGIN_RATE_LIMIT_MAX` changed from 100 → **10**; window changed to **900000ms (15 min)** |
| `.env.example` | Added `LOGIN_RATE_LIMIT_MAX=10` and `LOGIN_RATE_LIMIT_WINDOW_MS=900000` with comments |
| `apps/web-frontend/src/App.tsx` | Moved `/reports/schedules` route BEFORE `/reports/:slug` (route ordering fix) |
| `apps/web-frontend/src/pages/gst/EInvoicePage.tsx` | Added dismissible amber STUB warning banner (sessionStorage-based) |
| `apps/web-frontend/src/pages/DashboardPage.tsx` | Added staleness badge when `dataUpdatedAt` > 30 seconds ago |
| `apps/search-service/src/__tests__/search-auth.test.ts` | **NEW** — 3 integration tests (no auth → 401, bad prefix → 401, valid Bearer → 200) |

### Key Facts for Subsequent Phases
- Search service now **requires** a valid Bearer JWT on every route — internal callers must pass tokens
- Rate limit is now `10 requests per 15 minutes` on the login endpoint
- `/reports/schedules` is navigable; `/reports/:reportSlug` still works for all other slugs
- e-Invoice page has a STUB banner — **ES-11 is responsible for removing it** when NIC integration is live
- Dashboard has a staleness indicator polling every 5s when data age > 30s
- The ERP-wide ESLint config lacks `globals: { process: 'readonly' }` — pre-existing issue; add `/* global process */` directive when you encounter it in new files

---

*Sessions that depend on this: All phases (security baseline is in place)*
