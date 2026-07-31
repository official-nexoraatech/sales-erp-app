# Organization Module — Production-Readiness Audit (2026-07-25)

**Scope:** Narrow follow-up to the completed Tenant Management audit. Covers only: logo
upload/storage, tenant theme sync (BroadcastChannel), POS branding, org-level settings not
already covered (fiscal year, currency, invoice numbering), and org hierarchy display. Tenant
CRUD, suspension, branch/warehouse CRUD, org settings save mechanics, SSO config, and
cross-tenant admin are OUT of scope (already verified elsewhere).

All findings below were verified live against tenant 2 ("QA E2E Test Co") through the gateway
(`localhost:3000`), report-service (`localhost:3015`), and MinIO (`localhost:9000`), logged in
as `owner@qa-e2e.local`. Test artifacts are in the session scratchpad (`org19_*` files).

## Summary

Logo upload is real and works end-to-end: a PNG uploaded through the Organization Settings
page's own working UI lands in MinIO under a private, tenant-scoped key, is retrievable via a
correctly-signed short-lived URL, and the raw bucket correctly rejects unsigned access (403).
Tenant theme sync (brand colors, not logo) is soundly built and wired on both web-frontend and
POS — BroadcastChannel cross-tab sync, persistence, and RBAC are all in order. However, two
things below fully qualify as broken: **POS never renders the tenant logo anywhere** (theme
colors only), and **the only way to reconfigure an invoice-number prefix crashes 100% of the
time** with a 500, due to an `onConflictDoUpdate` target that doesn't match the table's real
unique constraint — meaning the very feature the audit was asked to test end-to-end
(prefix change → new invoice number) can never be exercised because the change can never be
saved. A separate, previously-undiscovered defect was also found: the invoice PDF template
receives the raw, unsigned S3 object key as the logo's `<img src>`, not a resolved URL, so even
once a logo exists it can never render correctly on a printed/emailed invoice — this is
self-documented as a known gap in a code comment, not something introduced today. Fiscal Year
Start, currency, and date format all save correctly at the org level but are confirmed
**fully disconnected** from accounting-service's Financial Year feature, which takes its own
manually-entered start/end dates with zero reference to organization_settings.

## What Works (verified live)

1. **Logo upload → MinIO → signed retrieval, full round trip.**
   - Uploaded `org19_logo.png` (70-byte PNG) via `POST /api/tenant/organization/logo/upload` as
     OWNER → `200 {"data":{"logoObjectKey":"tenant/2/logo/1784938057102-org19_logo.png"}}`.
   - `GET /api/tenant/organization` afterward shows the key persisted
     (`logoObjectKey: "tenant/2/logo/1784938057102-org19_logo.png"`, `version` bumped 19→20).
   - `GET /api/tenant/organization/logo` → `302` redirect to a real AWS SigV4-signed MinIO URL
     (`X-Amz-Signature=...`, 1-hour expiry).
   - Downloaded that signed URL directly: `HTTP 200`, 70 bytes, **byte-identical** (`cmp`) to the
     uploaded file.
   - Direct unsigned GET to the same object path on MinIO (`localhost:9000/erp-local/tenant/2/...`)
     → `403` — confirms the bucket is genuinely private and the migration 0101 fix (rename
     `logo_url`→`logo_object_key`, resolve to a signed URL on read) is real and functioning, not
     just renamed.
   - Frontend side (`apps/web-frontend/src/pages/settings/OrganizationPage.tsx`) has a complete,
     wired upload UI: file input with MIME/size validation client-side, `uploadLogoMutation`,
     blob-preview via `useObjectUrl`, "Upload logo"/"Replace logo" button — not just a backend
     capability with no UI.

2. **Tenant theme sync (color/font/radius) — sound on both frontends.**
   - `apps/web-frontend/src/components/erp/TenantThemeSync.tsx` and the POS counterpart both
     apply `themeConfig` (brandPrimary/Secondary/Accent, fontSans, radiusScale) as CSS custom
     properties, correctly reset on tenant clear, and correctly skip overrides in
     high-contrast mode (documented, deliberate a11y guarantee).
   - Both mount a `BroadcastChannel('nexoraa-tenant-theme')`; `OrganizationPage.tsx` calls
     `broadcastTenantThemeChange()` on save (both the logo-upload success path and the main
     settings-save path) so other same-origin tabs invalidate `['organization']` and re-fetch.
   - Confirmed `themeConfig` persists correctly server-side — GET returned a real
     tenant-configured value (`brandPrimary:"#f20202"`, `brandAccent:"#e7d508"`,
     `radiusScale:"sharp"`, from a prior session) round-tripping through PUT/GET.
   - **Caveat, by design, not a bug:** POS and web-frontend are separate origins/ports, so
     `BroadcastChannel` only syncs tabs _within_ the same app — a change in the desktop ERP
     reaches an open POS tab only on its next 60s `staleTime` refetch or reload. This is
     explicitly documented in the POS component's own comment, not a hidden gap.
   - Did not drive an actual multi-tab browser (no browser automation available in this
     session); verified via full code-path read + live persistence/RBAC instead, per the task's
     own fallback instruction.

3. **Org settings (currency, fiscal year start, date format) save correctly.**
   - `PUT /api/tenant/organization` with `currency:"USD"`, `fiscalYearStart:"01-01"`,
     `dateFormat:"YYYY-MM-DD"` → `200`, all three values round-tripped on the next GET,
     `version` incremented (21). Restored to original values (`INR`/`04-01`/`DD/MM/YYYY`)
     afterward to avoid disrupting other concurrent QA sessions on this shared tenant.

4. **RBAC spot-check on branding-specific permissions.**
   - Logged in as `cashier@qa-e2e.local` (no `ORG_SETTINGS_EDIT`): `PUT /organization` → `403
FORBIDDEN "Missing permission: ORG_SETTINGS_EDIT"`; logo upload → same `403`.
   - Cashier's `GET /organization` correctly succeeds but with `gstin`/`pan`/`tan`/`cin`/
     `bankDetails` stripped from the response (confirms the F14 sensitivity-tiering fix from
     the 2026-07-23 tenant-service audit is live and working for a real non-privileged role).

5. **`invoiceFooter`/`termsAndConditions` genuinely flow into invoice PDFs.**
   - `apps/sales-service/src/api/invoice.routes.ts` (`GET /invoices/:id/pdf`) fetches
     `organizationSettings` fresh and passes `termsAndConditions`/`bankDetails`/`gstin`/`pan`
     into the PDF payload; `apps/report-service/src/templates/index.ts` renders
     `{{org.termsAndConditions}}` in the footer. This is a real, working cross-service
     consumer of an org-level setting (unlike the logo and fiscal-year cases below).

## Bugs/Gaps Found

### 1. Invoice-number prefix reconfiguration is 100% broken — always 500s (Critical)

The only entry point that can ever change an invoice/quotation/PO/etc. number prefix,
`POST /api/report/config/number-series/:type` (report-service, `PERMISSIONS.NUMBER_SERIES_CONFIG`,
OWNER has it), fails with `500 {"error":{"code":"INTERNAL_ERROR"}}` on **every single call**,
reproduced twice for `INVOICE` (existing row) and twice for `QUOTATION` (fresh row, no prior
config) — i.e. it fails on both the insert path and the update path.

Root cause (confirmed against live schema): `NumberSeriesEngine.configure()`
(`apps/report-service/src/domain/NumberSeriesEngine.ts:157-164`) does:

```ts
.onConflictDoUpdate({
  target: [numberSeriesConfig.tenantId, numberSeriesConfig.seriesType, numberSeriesConfig.financialYear],
  set: { formatTemplate, updatedAt: new Date() },
});
```

but the table's real unique constraint (confirmed via `\d number_series_config` against the
live Postgres) is:

```
"num_series_unique" UNIQUE CONSTRAINT, btree (tenant_id, series_type, branch_id, financial_year)
```

— it includes `branch_id`, which the `onConflictDoUpdate` target omits. Postgres requires the
`ON CONFLICT` target to exactly match an existing unique/exclusion constraint or it raises
`there is no unique or exclusion constraint matching the ON CONFLICT specification` — this
happens unconditionally at plan time, not only when a real conflict occurs, which is why even
the fresh-insert `QUOTATION` case also failed.

**Business impact:** this directly answers (in the negative) the audit's own key question —
"does an org's configured invoice prefix actually get used?" It cannot be tested end-to-end
because it can never be configured in the first place. Every tenant is permanently stuck on the
hardcoded default formats (`INV/{FY-SHORT}/{SEQ:5}`, etc.) with no way to add a company-specific
prefix, despite the feature existing, being permission-gated, and (per code comments) having
been _deliberately built_ to be shared/consistent between report-service and sales-service.
There is also no frontend for this at all (see gap 2), so a UI-only audit would never even
reach this bug — it was found by calling the API directly.

**Evidence:** `org19_reconfig_resp.json`, `org19_reconfig_qtn.json`, `org19_reconfig_qtn2.json`
(all `HTTP 500`), live `\d number_series_config` output in this session's tool output.

### 2. No frontend anywhere for invoice-number-series configuration (High)

Confirmed via repo-wide grep: `config/number-series` and `NUMBER_SERIES_CONFIG` appear only in
report-service's own routes/tests — zero references in `apps/web-frontend/src` or
`apps/pos-frontend/src`. Even if bug #1 above were fixed, there is currently no Settings page,
button, or form anywhere that would let a real user reach this endpoint. It is API-only,
reachable only by a direct authenticated HTTP call — not usable in practice today.

### 3. POS frontend never renders the tenant logo (High)

Confirmed via full-file grep of `apps/pos-frontend/src` for `logo`, `TenantLogo`, `orgName`,
`companyName`, `organizationApi`: the only "logo" hits are the `LogOut` icon import (unrelated).
`TenantThemeSync` **is** mounted in POS (`main.tsx:225`) and does apply the tenant's brand
colors/font, but there is no `TenantLogo`-equivalent component, no call to
`GET /organization/logo`, and no logo `<img>` anywhere in `POSScreen.tsx`, the shift screens, or
the ESC/POS receipt code (`escpos.ts`, `ReceiptOverlay.tsx`, `webPrinter.ts` — none reference
logo/org name/company). Contrast with web-frontend, which has a complete `TenantLogo.tsx`
component wired into `Layout.tsx`'s sidebar. This directly answers audit item #3: POS reflects
tenant **branding colors**, but not the **logo**, anywhere — not in the terminal UI, not on
printed receipts.

### 4. Invoice PDF embeds the raw (unsigned) S3 object key as the logo image source, not a URL (High)

`apps/sales-service/src/api/invoice.routes.ts:400-404` sets the PDF payload's `org.logoUrl` to
`org?.logoObjectKey` verbatim — i.e. a bare key like
`tenant/2/logo/1784938057102-org19_logo.png` — and the template
(`apps/report-service/src/templates/index.ts:31`) renders it directly:
`<img src="{{org.logoUrl}}" class="logo" alt="Logo">`. This is not a resolvable URL (it's a
private-bucket object key with no scheme/host, and the bucket is confirmed private/403 on
unsigned access above) — the `<img>` can never load. This is **self-documented** in the code's
own comment as a known, still-open gap ("kept as the `logoUrl` key here since that's what
report-service's PDF template expects, not resolved to a real URL by this fix" — dated
2026-07-23), so it predates this session, but it is real and currently live: now that logo
upload actually works (bug that comment references was fixed), this is the next thing standing
between "logo uploaded" and "logo appears on an invoice," and nothing currently resolves it. The
correct pattern already exists one file away (`GET /organization/logo`'s
`storageClient.getSignedUrl()`) but isn't reused here.

**Could not cleanly demonstrate the live rendering symptom** because PDF generation itself is
currently down platform-wide in this dev environment (see Untested section) — but the code
defect itself is unambiguous and independently verified by reading both ends of the data flow.

### 5. Fiscal Year Start is a pure cosmetic org field — zero consumers (Medium)

`organizationSettings.fiscalYearStart` (confirmed via repo-wide grep) is referenced **only** in
`apps/tenant-service/src/api/organization.routes.ts` and its own test file — nowhere else in the
codebase. `accounting-service`'s `FinancialYearService.create()`
(`apps/accounting-service/src/domain/FinancialYearService.ts:85-117`) takes fully
manually-entered `yearCode`/`startDate`/`endDate` from whoever calls it, with no lookup of
organization settings at all. Changing an org's Fiscal Year Start via Settings has **zero**
effect anywhere else in the system — it's saved, displayed back, and otherwise inert. This
matches (and confirms with certainty) what the audit prompt asked to check.

## Untested / Unknown Areas

- **PDF generation is currently down platform-wide in this dev environment.** `POST
/reports/pdf` (report-service, direct + via sales-service's `GET /invoices/:id/pdf`) returns
  `500 INTERNAL_ERROR` / `422 PDF_GENERATION_FAILED` for **every** document type and payload
  tried, including a minimal payload with no logo at all — so this is not something this
  session's logo upload caused. report-service's own `/health` reports `healthy` with a 5.7-hour
  uptime, and this session's scratchpad shows a different concurrent session successfully
  generated real invoice/P&L PDFs earlier the same day (`rpt_invoice_test.pdf`, 119KB, valid PDF
  header) — so the Puppeteer-backed PDF engine most likely crashed or exhausted resources
  sometime between then and now (consistent with the known "machine has a real memory ceiling on
  repeated full-stack restarts" issue already in project memory). **This blocked live
  confirmation of bug #4's visual symptom** and blocked live confirmation of the
  `invoiceFooter`/`termsAndConditions` PDF rendering beyond code inspection. Recommend re-running
  a PDF generation smoke test after a report-service restart.
- **Cross-tab BroadcastChannel behavior** was verified by full code-path reading (mount points,
  channel names matching, invalidation logic) and live persistence, but not driven with an
  actual two-tab browser session — no browser automation was available in this session.
- **Org hierarchy / structure view:** no such feature exists anywhere in the codebase — no
  "org chart," "organization structure," or "hierarchy" component/page in web-frontend, and no
  planned spec for one found in `ERP-PLANNING/` (only an unrelated "departments/cost centers"
  gap-prompt matched the search). Branches/warehouses are only ever shown as flat lists
  (already covered by the Tenant Management audit). Treating this as "doesn't exist" rather than
  "broken" — there's nothing to test.
- **Cross-tenant isolation** for the organization endpoints specifically was not independently
  re-driven with a second tenant's token in this session (all org-scoped queries use the
  standard `ctxFor(request).db` / `eq(organizationSettings.tenantId, tenantId)` pattern already
  verified generically by the Tenant Management audit); spot-checked only same-tenant RBAC
  (owner vs. cashier) above.
- **SVG logo uploads** are permitted by `LOGO_MIME_TYPES` (`image/svg+xml`) on both frontend and
  backend but weren't tested live — SVGs can carry embedded scripts; whether MinIO/the signed-URL
  serve path applies any sanitization was not checked.

## Test Data Created

- Tenant 2 organization logo permanently set to `tenant/2/logo/1784938057102-org19_logo.png`
  (a 1×1 red-pixel PNG) — left in place, this is dev data and a logo being present doesn't
  disrupt anything, but it does mean bug #4 (broken PDF `<img src>`) is now "live" for tenant 2
  until fixed.
- Invoice #129 created and confirmed for tenant 2 (`INV/26-27/00006`, customer "Ramesh
  Textiles," 1× Cotton Saree, ₹1000 + 5% GST) — real, confirmed invoice, left as-is.
- Currency/fiscalYearStart/dateFormat were changed to `USD`/`01-01`/`YYYY-MM-DD` and then
  restored to the original `INR`/`04-01`/`DD/MM/YYYY` before ending the session.
- `numberSeriesConfig` gained a `QUOTATION` row for tenant 2 (auto-created as a side effect of
  the failed configure attempts) with the default template — harmless, matches what would have
  been auto-created on first real quotation anyway.

## Readiness Score: 48/100

Justification (narrow-scope score — Tenant Management's core CRUD/suspension/branch/warehouse
work is excluded, already scored elsewhere):

- Logo storage/retrieval infrastructure (the part migration 0101 targeted): **fully working,
  well-built, verified byte-for-byte live.** This alone would be 80+/100 if it were the whole
  scope.
- But two of the five things this audit was specifically asked to test end-to-end are
  substantively broken: invoice-number-prefix configuration is **not just missing a UI, it 500s
  unconditionally at the API level** (a real, deterministic code bug, not a gap), and fiscal
  year start is confirmed **completely disconnected** from the accounting module that a
  reasonable user would expect it to drive.
- The logo, once uploaded, is invisible in two of the three places a tenant would expect to see
  it: POS (entirely absent) and invoice PDFs (present in code but wired to a value — the raw
  object key — that can never render).
- Theme color sync (as opposed to logo) is the one piece of "branding" that is genuinely solid
  end-to-end on both frontends.
- Score reflects: real, working foundation for logo storage + theme sync, undermined by a
  completely non-functional invoice-numbering feature and two more logo-specific display gaps
  that mean "upload a logo" doesn't actually achieve "tenant sees their branding everywhere" —
  which is presumably the point of the feature.
