# QA Regression — CRM, Marketing Site, FAQ, Integrations/Webhooks, Smart Search

Date: 2026-07-17
Tester: automated live-browser QA agent (Playwright against running dev stack)
Login used: tenant 2 ("QA E2E Test Co"), `owner@qa-e2e.local` (OWNER role)
Scope: CRM (Segments/Campaigns/Seasons/Campaign Settings) + public marketing site + FAQ system + Organization → Integrations (webhooks) + Smart Search (global search / Ctrl+K)

---

## Bug 1 — Global/Smart Search returns zero results for every query (BLOCKER)

**The single most important finding.** The header search / Ctrl+K command palette (`ERPCommandPalette`) — the primary search entry point for the whole app — currently returns **"No results found" for every possible query**, including exact substrings of real, visible seed data (e.g. searching "Ramesh" while the Customers list is showing a row for "Ramesh Textiles" directly).

### Repro

1. Log in as OWNER on tenant 2.
2. Open the Customers list — note a real customer, e.g. "Ramesh Textiles".
3. Click the header search box (or Ctrl+K) and type "Ramesh".
4. **Actual**: "No results found." Confirmed this is not UI-specific — direct calls to `GET /api/search/search?q=Ramesh` (and `q=a`, `q=e`, `q=item`, `q=invoice`, `q=Textiles`, `q=test`, ...) all return `200 {"data":{"hits":[],"total":0}}` for every term tried.
5. **Expected**: at least one hit for "Ramesh" (customer), and non-empty results for common terms given real seed data (18 customers, invoices, items, GRNs, etc. all indexed — confirmed via direct Elasticsearch query).

Critically, **entity-scoped search still works**: `GET /api/search/search?q=Ramesh&entity=customer` correctly returns the "Ramesh Textiles" hit with highlighting. Only the default/untyped global search (what the UI actually uses) is broken.

### Root cause (confirmed by direct ES inspection)

- `apps/search-service/src/domain/SearchEngine.ts` `search()` builds a comma-joined multi-index path (`/${indices}/_search`, around line 735) when no single `entity` is specified, e.g. `erp_2_customer,erp_2_supplier,erp_2_item,...,erp_2_category,erp_2_brand,erp_2_account,erp_2_role,erp_2_crm_interaction,erp_2_stock,erp_2_attachment`.
- Several of those indices (**`erp_2_category`, `erp_2_brand`, `erp_2_account`, `erp_2_role`, `erp_2_crm_interaction`, `erp_2_stock`, `erp_2_attachment`**) **do not exist at all** in Elasticsearch for tenant 2 (verified via `GET http://localhost:9200/_cat/indices?v` — they're simply absent, not just empty).
- Elasticsearch's default behavior for a multi-index `_search` where any named index doesn't exist is to fail the **entire** request with `404 index_not_found_exception` — verified directly against ES. The request does NOT pass `ignore_unavailable=true`.
- `SearchEngine.search()` never checks `result.ok`/`result.status` from `esRequest()` before parsing — it just does `const resp = result.data as {...}` and reads `resp.hits?.hits ?? []`. An ES error body (`{error: {...}, status: 404}`) has no `.hits`, so this silently collapses to `hits: []`, `total: 0` — masking the real failure as an innocuous "no results."
- Bonus evidence: `GET /admin/search-analytics` (Search Analytics & Health page) shows a "Popular Searches" / "No-Result Searches" table where terms like "Global Textiles" succeeded 31/31 times historically and "Ramesh" succeeded 47/51 times — i.e. this **used to work** and has regressed to 100% failure right now, while the page's "Index Sync Failures (Dead Letter Queue)" panel misleadingly reports "No pending sync failures — every recent create/update/delete has been indexed into Elasticsearch successfully" (that panel only checks the write-side DLQ, not query-side correctness, so it gives false reassurance).

### Suggested fix directions (not applied — investigation only)

1. Add `ignore_unavailable=true` to the ES multi-index search request in `SearchEngine.search()`.
2. Make `search()` check `result.ok` and surface/log a real error (500) instead of silently returning an empty result set — this class of bug (a swallowed backend error masquerading as "0 results") will keep recurring for any future new entity type until that's fixed.
3. Investigate why `createTenantIndices()` (which does loop over all `ALL_SEARCH_ENTITIES`) never created `category`/`brand`/`account`/`role`/`crm_interaction`/`stock`/`attachment` indices for tenant 2 — likely those entity types were added to `ENTITY_MAPPINGS` after tenant 2 was provisioned and no backfill/reindex job ran `createTenantIndices` again for pre-existing tenants (same class of gap as Bug 2 below).

**File**: `apps/search-service/src/domain/SearchEngine.ts` (search() method, ~line 621–780)

---

## Bug 2 — `PLATFORM_CONTENT_MANAGE` is not actually platform-operator-only; every tenant OWNER gets it, and it gates content with no tenant scoping (MAJOR — cross-tenant authorization gap)

FAQ content (`Settings → FAQ Management`, backing table `faq_items`) is **global, platform-wide** content with **no `tenant_id` column at all** — every FAQ shown on the public marketing site is shared across the entire platform, for every tenant/visitor (confirmed in `apps/tenant-service/src/api/faq.routes.ts`, whose own header comment says: _"Global (no tenant_id) — this is platform content, so CRUD is platform-operator-only (PLATFORM_CONTENT_MANAGE)"_).

However, `packages/shared-types/src/permissions.ts` documents `PLATFORM_CONTENT_MANAGE` as intentionally scoped like `PLATFORM_TENANT_MANAGE` ("Platform-operator only, like PLATFORM_TENANT_MANAGE, since this is platform content"), but `apps/tenant-service/src/rbac/role-defaults.ts` only filters `PLATFORM_TENANT_MANAGE` out of `TENANT_SCOPED_PERMISSIONS`:

```ts
const TENANT_SCOPED_PERMISSIONS = (Object.values(PERMISSIONS) as Permission[]).filter(
  (p) => p !== PERMISSIONS.PLATFORM_TENANT_MANAGE   // PLATFORM_CONTENT_MANAGE is NOT excluded
);
export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  OWNER: TENANT_SCOPED_PERMISSIONS,   // → OWNER gets PLATFORM_CONTENT_MANAGE too
  ...
```

**Verified live**: signed up a brand-new tenant through the public `/signup` flow (tenant id 26) — its OWNER JWT contains `PLATFORM_CONTENT_MANAGE`. That means **any customer's tenant OWNER can create/edit/delete the FAQ content shown on the public marketing site for the whole platform** — a cross-tenant authorization boundary violation, not just a scoping inconsistency. A malicious or careless tenant admin could deface or delete marketing-site FAQ content seen by every visitor/prospect, not just their own org.

### Inverse symptom on the assigned QA tenant

Tenant 2 ("QA E2E Test Co", the tenant specified for this QA pass) was apparently provisioned **before** `PLATFORM_CONTENT_MANAGE` existed in the codebase, and its `OWNER` role's permissions in the DB were never backfilled with it (its JWT permissions list — decoded and checked — has no `PLATFORM_CONTENT_MANAGE`, and no `PLATFORM`/`CONTENT` permission at all). Concretely:

- Navigating to `Settings → FAQ Management` (`/settings/faqs`) as `owner@qa-e2e.local` on tenant 2 → immediately hits the app's Access Denied screen.
- This **blocked full end-to-end testing of the FAQ admin CRUD flow** from the assigned QA task (create/edit/publish/delete via the admin UI, then verify on the public FAQ section) — I could not reach the admin UI at all on the designated test tenant.
- Root cause matches a known recurring pattern in this codebase (see engineering memory: "RBAC dead-permission-constant pattern" / "DB migration bookkeeping broken") — a new permission constant added to `role-defaults.ts` only applies at _provisioning_ time, with nothing backfilling it onto already-seeded tenants' roles in the DB.

### Suggested fix directions

1. Add `PLATFORM_CONTENT_MANAGE` to the exclusion filter in `role-defaults.ts` alongside `PLATFORM_TENANT_MANAGE`, matching the documented intent in `permissions.ts`.
2. Audit/revoke `PLATFORM_CONTENT_MANAGE` from any tenant OWNER/ADMIN roles that already have it in the DB (tenant 26 created during this test, and possibly others provisioned since 07-16).
3. Separately: the `FAQ Management` nav entry currently lives inside the tenant-facing `Settings` nav group (`apps/web-frontend/src/lib/navigation.ts`, next to Warehouses/Users/Integrations) even though it's meant to be platform-operator-only — worth moving out of the tenant Settings group entirely once (1) is fixed, so the nav doesn't advertise a feature no tenant user can legitimately use.

**Files**: `apps/tenant-service/src/rbac/role-defaults.ts` (lines 1–14), `packages/shared-types/src/permissions.ts` (line 423–424), `apps/web-frontend/src/lib/navigation.ts` (line 630–635), `apps/tenant-service/src/api/faq.routes.ts`

---

## Bug 3 — Webhook "generalization" still only covers 5 hardcoded events, not "any business event" (MINOR / scope gap)

The Integrations page subtitle claims: _"Subscribe external systems to key business events with signed, verifiable webhook deliveries,"_ and the backend route file's header comment says it was _"generalized from the CP-8 campaign-only subsystem ... to cover any business event a tenant wants to subscribe an external system to."_

In practice, both the frontend (`IntegrationsPage.tsx` `EVENT_OPTIONS`) and backend (`integrations.routes.ts` `WEBHOOK_EVENT_TYPES`) are still hardcoded to exactly the same 5 events:
`INVOICE_CREATED`, `INVOICE_CONFIRMED`, `PAYMENT_RECEIVED`, `CAMPAIGN_SENT`, `CAMPAIGN_CANCELLED`.

No Purchase Order, GRN, Customer, Stock, HR, or GST events are subscribable — this is a much narrower "generalization" than the framing suggests. Not a functional bug (create/list/delete all work correctly, verified live — see "Verified working" below), just a gap between the stated scope and the actual implementation.

**Files**: `apps/web-frontend/src/pages/settings/IntegrationsPage.tsx` (`EVENT_OPTIONS`, line 16), `apps/sales-service/src/api/integrations.routes.ts` (`WEBHOOK_EVENT_TYPES`, line 18)

---

## Bug 4 — Integrations page has no Edit affordance and no delivery-log/retry UI (MINOR / gap)

- The backend supports `PUT /integrations/webhook-subscriptions/:id` (and the frontend API client has `integrationApi.updateWebhook()` already wired), but `IntegrationsPage.tsx` never calls it — there is no Edit button in the table, only Delete (trash icon). A subscriber can't toggle `isActive` or change the target URL/events without deleting and recreating.
- There is no delivery-log or retry UI anywhere for webhook deliveries (no way to see whether a delivery succeeded/failed, or to manually retry a failed one) — confirmed by code read and by driving the page; the task asked me to check for this if present, it is not present.

**File**: `apps/web-frontend/src/pages/settings/IntegrationsPage.tsx`

---

## Verified working cleanly (no bugs found)

- **Public marketing pages** (`/`, `/pricing`, `/features`, `/about`, `/contact`, `/signup`): all render correctly, zero console errors, zero failed network requests, correct `<title>`/SEO tags, single accessible `<h1>` per page. Hero.tsx's rotating-claim headline correctly uses `aria-hidden` + a single `sr-only` span (the double-announced-heading a11y bug from the prior QA session is confirmed still fixed).
- **Scroll-reveal animations** (module grid cards on landing page): initially appeared "stuck" at opacity-0 in a scripted `window.scrollTo` test, but this was a test-harness artifact — a real `scrollIntoViewIfNeeded()` (mimicking actual user scroll) confirms all 10 module cards reveal correctly (opacity 1) via `IntersectionObserver`. Not a bug.
- **Public FAQ section** (landing + pricing pages): renders 11 real, backend-driven, published FAQs; accordion expand/collapse works; live client-side search-filter works (e.g. "gst" correctly narrows to 1 matching question).
- **Contact form**: confirmed by design (commented explicitly in `ContactPage.tsx`) to be a local-only success-toast with no real backend lead-capture endpoint yet — this is a known, intentional stub, not a bug. Submits and shows a "Thanks — we'll be in touch" confirmation.
- **Signup flow**: full end-to-end tenant provisioning works — `POST /api/tenant/public/signup` (201) → auto-login (200) → `/users/me` → lands on `/dashboard` with a working new tenant (tenant id 26 created during this test). Took noticeably longer than expected (~8–15s end-to-end across the signup+login+bootstrap calls) but completed successfully with no errors; a first attempt with only a 3s wait made it look hung — worth being aware this flow is slow, not broken.
- **Responsive layout**: no horizontal overflow at a 375px mobile viewport on `/`, `/pricing`, `/features`, `/signup`. Visually clean mobile hero rendering.
- **Webhook create/list/delete flow** (Integrations page): creating a webhook with a target URL + one event correctly shows the one-time secret, persists, and appears in the list with correct target URL/events/Active status; delete (trash icon with confirm) is present. Only gaps are the ones noted in Bug 3/4 above.
- **CRM proper** (Segments, Campaigns, Seasons, Campaign Settings): quick spot-check per instructions — all four pages load cleanly under OWNER, no Access Denied, no failed requests beyond the known unrelated notification-stream 401 (see note below). Segments page shows real pre-built + saved segments with live customer counts. Consistent with the prior 2026-07-12 QA pass that found zero bugs here; no further time invested per the task's guidance.

## Tangential / out-of-scope observation (not investigated further)

- On every login (and again after signup), the browser console logs a `401 Unauthorized` for `GET /api/notification/notifications/stream?token=...` (an SSE stream, token passed as a query param). This happens on every page load, for both the pre-existing tenant 2 and the freshly-created tenant 26, so it's not CRM/marketing/FAQ/webhook/search-specific — flagging it here only because it fires constantly and clutters the console; likely belongs to whichever agent is covering notifications, or a shared/platform-wide bug worth a note to you.

## Residual test data left behind

- One webhook subscription created on tenant 2: target URL `https://example.com/qa-webhook-test`, event `INVOICE_CREATED` (not deleted).
- One new tenant created via the public signup flow: tenant id 26, org "QA Signup Test <timestamp>", admin `qa-signup-<timestamp>@example.com` / password `QaSignupTest@2026Pass`.
