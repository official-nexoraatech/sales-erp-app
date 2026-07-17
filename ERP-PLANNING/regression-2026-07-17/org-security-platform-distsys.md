# QA Regression — Organization / Security / Distributed Systems / Platform Admin

Date: 2026-07-17
Tester: automated QA agent (Playwright live E2E against localhost:5173 / gateway :3000)
Login used: OWNER role, tenant 2, `owner@qa-e2e.local`
Scope: Organization (Branches, Warehouses, Users, GST Config, Feature Flags, SSO Config, Security Settings),
Security Audit Log, Audit Logs, Event Store, DLQ, Saga Monitor, Schema Registry, Projections, Performance,
Search Analytics, Platform Admin, plus an RBAC restricted-user check.

Scratch scripts used: `apps/web-frontend/.qa-tmp/org-*.mjs` (not committed).

---

## Bugs found

### 1. [BLOCKER] API gateway CORS blocks every PUT/PATCH/DELETE from the browser — breaks all edit/update/delete operations app-wide

**Repro:**

1. Log in as OWNER (tenant 2).
2. Go to Settings → Organization, edit any field (e.g. Address Line 1 / City / State), click "Save Changes".
3. Observe a "Failed to fetch" toast; nothing is saved.
4. Browser console shows: `Access to fetch at 'http://localhost:3000/api/tenant/organization' from origin 'http://localhost:5173' has been blocked by CORS policy: Method PUT is not allowed by Access-Control-Allow-Methods in preflight response.`
5. Same repro on Settings → Branches → edit an existing branch (e.g. change City) → `Failed to fetch` toast, same CORS console error, PUT never reaches `tenant-service`.

**Expected:** Save succeeds; PUT reaches the service through the gateway.
**Actual:** Every PUT (and almost certainly PATCH/DELETE) call is blocked by the browser's CORS preflight check at the gateway layer, before it even reaches the upstream service.

**Root cause (confirmed by code read):**
`apps/api-gateway/src/app.ts` registers `@fastify/cors` without a `methods` option:

```ts
await fastify.register(cors, {
  origin: config.allowedOrigins,
  credentials: true,
});
```

`@fastify/cors` defaults to `methods: 'GET,HEAD,POST'` when `methods` is omitted. Every individual backend service (`auth-service`, `tenant-service`, `inventory-service`, `sales-service`, `gst-service`, `accounting-service`, `purchase-service`, `hr-service`, `production-service`, `notification-service`, `report-service`, `scheduler-service`, `search-service`, `event-service`) correctly imports and passes a shared `CORS_METHODS` constant (e.g. `apps/tenant-service/src/main.ts:77-81`) — this was the exact fix applied on 2026-07-12 for the "CORS PUT blocked app-wide" bug (see project memory `qa_cors_put_blocked_appwide_2026_07_12`). But **the api-gateway itself never got the same fix**, and since the 2026-07-16 gateway cutover (`gateway_cutover_2026_07_16`), the gateway is now the browser's actual CORS boundary — the per-service fix no longer matters because the browser never gets far enough to hit those services' own CORS headers.

**Impact:** This is a full regression of the 2026-07-12 fix, reintroduced at a new layer. It silently breaks **every edit, status-change, approve/reject, and delete action across both frontends** (web-frontend and pos-frontend), not just the pages in this module's scope. Confirmed live on: Organization Settings save, Branch edit. Also confirmed via request-payload interception that Warehouse edit would hit the same wall (browser-level CORS blocks the request before Playwright's route mock or the real gateway ever sees it).

**Fix location:** `apps/api-gateway/src/app.ts` — import `CORS_METHODS` (same shared constant every other service uses) and pass it into the `cors` plugin registration, matching the pattern in e.g. `apps/tenant-service/src/main.ts:77-81`.

**Severity: BLOCKER** — this is almost certainly the single highest-priority fix from this session; it affects the entire platform, not just this module.

---

### 2. [MAJOR] Users list "Roles" column is always blank — GET /users list endpoint never returns roles

**Repro:**

1. Log in as OWNER, go to Organization → Users.
2. Observe the "Roles" column is empty for every single user in the list, including users known to have roles (Sales Manager, Cashier, Inventory Manager, Account Ant, etc.)

**Expected:** Each row shows the user's assigned role(s).
**Actual:** Column is always empty.

**Root cause (confirmed by code read):**

- `apps/auth-service/src/routes/users.ts` — the `GET /users` list handler (lines 77-89) does a plain `select().from(users).where(eq(users.tenantId, tenantId))` with no join to `userRoles`/`roles`, so the response objects never contain a `roles` field. Confirmed live: the raw API response for `GET /api/auth/users` contains `id, email, firstName, lastName, phone, isActive, ...` — no `roles` at all.
- The single-user `GET /users/:id` handler (lines 92-120) _does_ fetch `userRoleRows` and return `roleIds`, but that's not used by the list page.
- Frontend: `apps/web-frontend/src/pages/users/UsersPage.tsx` (around line 130-134) renders `(r.roles ?? []).map(role => ...)` expecting a `roles: string[]` field that the list endpoint never sends, so it silently always falls back to `[]`.

**Impact:** Admins cannot see at a glance which role any user has without opening each user individually — meaningfully impairs the Users admin screen, and directly touches the RBAC-fix area from earlier today's role-defaults backfill work.

**Fix location:** `apps/auth-service/src/routes/users.ts` GET /users handler — join `userRoles`→`roles` (or a lightweight roles-name subquery) and include a `roles` array per user. Frontend already expects the right shape.

**Severity: MAJOR**

---

### 3. [MINOR] Performance Baselines page shows "undefinedms" for every configured target — field-name mismatch

**Repro:**

1. Log in as OWNER, go to Distributed Systems → Performance.
2. Look at "Configured Targets" section.

**Expected:** Each target shows its configured latency (e.g. "500ms").
**Actual:** Every target shows literally `undefinedms`.

**Root cause (confirmed live + code read):**

- Backend (`apps/event-service/src/api/performance.routes.ts` lines 70-76, `GET /admin/performance/targets`) returns `{ endpoint, method, targetP95Ms }`.
- Frontend (`apps/web-frontend/src/pages/admin/distributed/PerformancePage.tsx`) — `PerformanceTarget` interface (line 22) declares `targetMs: number`, and `formatMs(t.targetMs)` (line 197) is called with the wrong field name, so `t.targetMs` is always `undefined`, producing the literal string `"undefinedms"`.

Same bug class as the previously-fixed Schema Registry field-name mismatch (confirmed still-fixed in this session — Schema Registry itself renders correctly).

**Fix location:** either rename the frontend interface field to `targetP95Ms` (matches backend), or rename backend's response field to `targetMs` — pick one convention and fix the read site at `PerformancePage.tsx:22,50,197`.

**Severity: MINOR** (cosmetic/display-only; the underlying targets are correctly configured and the page is otherwise functional — "Targets Configured: 4" count and endpoint/method columns are correct).

---

### 4. [MINOR] "Get Started — Setup Checklist" floating widget intercepts clicks on primary form-submit buttons

**Repro:**

1. Log in as OWNER (fresh/incomplete-checklist tenant), go to Settings → Branches → + New Branch.
2. Fill the form, try to click "Create Branch" (bottom-right of the form).

**Expected:** Click submits the form.
**Actual:** Playwright's actionability check reports the fixed-position "Get Started — Setup Checklist" widget (`.fixed.bottom-4.right-4`, a `w-80` panel) intercepts pointer events over the submit button; a plain `.click()` times out after 30s waiting for the element to become clickable. Only a forced click (bypassing the real interception check) gets through.

**Impact:** On any page where the checklist widget is showing (visible on nearly every page while the tenant's 0/7 checklist is incomplete) and the primary action button sits in the lower-right region of the viewport, a real user may be unable to click the button without first scrolling or dismissing the widget. This also means toast notifications (which render in the same bottom-right corner) likely fight the widget for the same screen real estate.

**Severity: MINOR** — workaround exists (scroll, or close the widget via its own X), but it's a real, reproducible interaction blocker on at least the New Branch form, and any other form whose submit button sits far right at that vertical position.

---

## Noteworthy state changes since last audit (not new bugs, per instructions)

- **Event Store admin page (`/admin/distributed/events`) is NO LONGER permanently empty.** It now shows real domain events (`INVOICE_CONFIRMED`, `INVOICE_CREATED` for `Invoice/106`), and the "Rebuild Aggregate State" control is present and wired to an aggregate type/ID. This was flagged in the 2026-07-13 QA pass as "a genuine architectural gap, no write path exists." As of this session, a write path clearly exists and events are visible. Worth confirming with the team whether this was an intentional fix landed since then, or a partial/incomplete wiring (only 2 events total were visible, both for one invoice) — recommend a follow-up check with more event-producing activity to confirm full coverage across aggregate types (not just invoices).
- **Schema Registry field-name mismatch (previously flagged) — confirmed fixed.** Renders real registered schemas (QA_E2E_TEST_EVENT_*, INVOICE_CONFIRMED, STOCK_RECEIVED, STOCK_DEDUCTED, PAYMENT_RECEIVED, etc.) with correct Version/Compatibility/Registered By columns.
- **CQRS Projections page shows real, useful data**, including 2 projections in `ERROR` status (`projection_dashboard_daily`, `projection_customer_balance`) and 4 flagged as stale (lag up to ~6999 min / ~5 days). This reflects genuine current system state in the dev environment, not a UI bug — flagging for the team's own triage, not reporting as a new defect (could be expected given no continuous rebuild job running in dev).

---

## RBAC restricted-user check — INCONCLUSIVE (tooling hang, not a confirmed app bug)

**What was completed:**

- Created a new user via Organization → Users → New User with role **CASHIER**: `qa-restricted-cashier@qa-e2e.local` / `QaRestricted@2026`, primary branch "Head Office". Creation succeeded (POST is unaffected by the CORS bug above since POST is in `@fastify/cors`'s default allowed-methods list): `201 POST /api/auth/users` returned the new user record (id 48).
- Confirmed the New User form's role dropdown offers: OWNER, ADMIN, SALES_MANAGER, CASHIER, PURCHASE_MANAGER, ACCOUNTANT, INVENTORY_MANAGER, HR_MANAGER, STAFF, ACCOUNTANT_SUPERVISOR, AUDITOR, DATA_OFFICER, SUPER_ADMIN.
- Captured the full OWNER-role sidebar nav for later comparison (Workspace/Sales & CRM/Inventory/Purchase/Accounting/Production/Analytics/HR & Payroll/Settings/Security/Distributed Systems sections all present, as expected for OWNER).

**What was NOT completed:** The actual login-as-CASHIER + nav-comparison + direct-URL-blocked-page checks (e.g. navigating to `/accounting/journals` or `/users` as the CASHIER user) did not finish — the browser automation script hung and the session was interrupted before it produced output. A retry was attempted but the Bash/PowerShell tool itself became temporarily unavailable (infra-side, unrelated to the app) before it could be re-run and this doc had to be finalized without it.

**Recommendation:** Re-run the login as `qa-restricted-cashier@qa-e2e.local` (tenant 2, password `QaRestricted@2026`) and check:

1. Sidebar nav — should NOT show Settings/Security/Distributed Systems/Accounting sections for a CASHIER.
2. Direct navigation to `/accounting/journals` and `/users` — should be blocked (ideally a clean "access denied" page, not a broken/half-rendered page), matching the pattern already confirmed for OWNER-vs-`/admin/tenants` in this session (OWNER, which correctly lacks `PLATFORM_TENANT_MANAGE`, gets a clean "Access denied" page via `PermissionRoute` — same mechanism should apply here).

This is flagged as a gap in this session's coverage, not a confirmed regression.

---

## Verified working cleanly (spot-checked or fully tested)

- **Organization Settings** — page loads real data (org name, legal name, GSTIN, PAN, branding colors/font/radius all populated and editable). Save is blocked only by bug #1 above (was previously confirmed working on 2026-07-13 before the gateway cutover); the underlying form/field-mapping logic itself looks correct (values round-tripped correctly in the request payload).
- **Branches** — list renders real data (3 branches: Head Office, QA E2E Branch, Debug Branch) after the first cold-load skeleton settles. Create (POST) works cleanly and **correctly persists city/state/address** (verified via API response: `address: {city, line1, state, pincode}` all populated) — the historical "city/state silently discarded" bug from 2026-07-13 remains fixed for creation. Edit is blocked only by bug #1 (CORS).
- **Warehouses** — list renders real data (4 warehouses) correctly, including branch names. Edit form loads existing data correctly with no row-pollution (previously-flagged bug), and the PUT payload correctly includes the `version` field (`{name, code, branchId, isDefault, version: 0}`) — the historical "missing version field" bug remains fixed. Actual save is blocked only by bug #1 (CORS), same as everything else.
- **Users list** — loads real data (11+ users visible), only the Roles column is broken (bug #2).
- **GST Configuration** — GST Rates (5 slabs: 0/5/12/18/28%), HSN Lookup, and GST Calculator all render and function correctly once past the initial cold-load skeleton.
- **Feature Flags** — renders real flags (notification_quiet_hours with editable start/end + Save, einvoice_enabled, whatsapp_enabled, fifo_valuation, mfa_required, purchase_3way_match, pos.enabled) with tenant-override indicators.
- **SSO Configuration** — form renders cleanly (Identity Provider dropdown, Issuer URL, Client ID/Secret, enable/skip-2FA checkboxes, Save Changes). Default/empty state as expected (no SSO configured for this tenant); did not attempt to save due to bug #1.
- **Security Settings** — Two-Factor Authentication section and Active Sessions list both render correctly.
- **Security Audit Log** — loads cleanly, correctly shows "No audit log entries" (this tenant has no impersonation/2FA/suspicious-login events yet — legitimate empty state, not a bug).
- **Audit Logs** — loads real, substantial data (customer creates, webhook subscriptions, stock transfers/adjustments, invoice status changes, campaign sends) with correct Time/Entity/Action/Actor/Changed Fields columns.
- **Event Store** — see "Noteworthy" section above; now functional with real data.
- **Dead Letter Queue** — loads cleanly, correctly shows 0 pending/replayed/discarded, 0 topics (no failed Kafka messages currently — expected empty state).
- **Saga Monitor** — loads real data (1 completed saga in last 24h, 0 failed/stalled/in-progress, 0.2s avg duration).
- **Schema Registry** — see "Noteworthy" section; confirmed fixed and fully functional.
- **CQRS Projections** — loads real, detailed data; see "Noteworthy" section for the ERROR/STALE states observed (informational, not a bug).
- **Performance Baselines** — loads and renders correctly except for bug #3 (undefinedms).
- **Search Analytics & Health** — loads real data (86 total searches, 9 no-result searches, 1192ms avg latency, popular/no-result search terms, index sync failures section).
- **Platform Admin (`/admin/tenants`)** — NOT independently re-tested this session (no PLATFORM_TENANT_MANAGE-capable credential was found in `ERP-PLANNING/TEST_CREDENTIALS.md` or elsewhere in the repo — this is a genuine credential gap for this session, not a re-test of prior findings). Confirmed instead that the OWNER role correctly does **not** have `PLATFORM_TENANT_MANAGE` in its JWT permissions, and that navigating to `/admin/tenants` as OWNER renders a clean "Access denied" page via `PermissionRoute` rather than a broken/crashed page — this is the correct behavior and demonstrates the permission-gating mechanism itself works. Per the 2026-07-13 QA pass, tenant provisioning/lifecycle/cross-tenant password reset were previously confirmed fully working; this session did not have credentials to re-verify.

## Gaps in this session's coverage

- **Platform Admin module** — no PLATFORM_OPERATOR credential available; only spot-checked that OWNER is correctly denied access.
- **RBAC restricted-user direct-URL / nav check** — inconclusive due to a tooling hang; see section above for exact recommended re-test steps and credentials already created (`qa-restricted-cashier@qa-e2e.local` / `QaRestricted@2026`, tenant 2, role CASHIER).
- Did not test SSO Configuration's actual Save (blocked upstream by bug #1, so testing it further would just re-confirm the same CORS bug).
