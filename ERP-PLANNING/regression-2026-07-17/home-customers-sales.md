# QA Regression — Home/Dashboard, Customers, Sales

Date: 2026-07-17
Tester: live-browser Playwright session against http://localhost:5173 (tenant 2 "QA E2E Test Co", OWNER role)
Scope: Home/Dashboard, Customers, Sales (Invoices, Quotations, Payments, Returns, Delivery Challans)

**Note on completeness:** this session was interrupted mid-run by a connection error. Everything below marked "verified" was actually driven in a real browser with screenshots and network captures. The "Not reached this session" list at the bottom is scoped honestly — those flows were not tested and should not be assumed to work or to be broken.

---

## Bugs found

### 1. [MAJOR] Invoice line quantity accepts negative numbers with zero validation

**Repro:** Sales → Invoices → New Invoice. Pick customer "Ramesh Textiles", Branch "Head Office", any warehouse, add item "Cotton Saree" (price ₹1000, GST 5%). Edit the Qty cell to `-5`.
**Expected:** Validation error, or at minimum the row/total should not silently accept a negative quantity.
**Actual:** UI recalculates instantly to Taxable ₹-5,000.00, Grand Total ₹-5,250.00, with no error message anywhere and the "Save as Draft" button stays fully enabled. Did not get to confirm whether the backend POST would also accept a negative-total invoice (session ended before that step) — but the complete absence of a client-side guard is itself a real gap; a fat-fingered qty entry could produce/attempt a negative invoice with no warning.
**Also:** Qty `0` is likewise accepted silently (₹0.00 line), which should also probably be blocked from being saved.
**File:** `apps/web-frontend/src/pages/sales/InvoiceFormPage.tsx` (line-item qty input / totals recompute logic).

### 2. [MAJOR] Sales list pages show raw numeric IDs instead of resolved names — systemic, not one page

**Repro:** Visit any of: Sales → Quotations, Sales → Invoices, Sales → Payments, Sales → Returns.
**Expected:** "Customer" column shows the customer's name (e.g. "Ramesh Textiles"); "Invoice" column on Returns shows the invoice number.
**Actual:** Every row shows a bare number instead — e.g. Quotations list showed "1" for every row's Customer column; Invoices list showed "1", "0", "375"; Payments list showed "0"/"1"; Sale Returns list showed raw invoice IDs ("45", "42") instead of invoice numbers like "QA-EVSTORE-TEST-...".
**Goes deeper than list pages:** Quotation detail page (`/sales/quotations/42`) literally renders "Customer ID: 1" and the line item as "Item 1" instead of the real item name "Cotton Saree" (confirmed item names DO exist and are used correctly elsewhere, e.g. the item-search-to-add combobox on the invoice form). Invoice detail page shows "Customer 1" — same gap, slightly softer label.
**Root cause confirmed via network capture:** `GET /api/sales/quotations` (list) and `GET /api/sales/quotations/:id` (detail) responses from sales-service only ever contain `customerId` / `itemId` — no resolved customer or item object is ever returned. This is a backend gap (no join/enrichment), not just a frontend rendering oversight, though the frontend also doesn't do a client-side lookup to compensate (unlike the item-search combobox, which does resolve names).
**Impact:** For a real staff member trying to work these lists day-to-day, this makes Quotations/Invoices/Payments/Returns effectively unusable without opening every single record to find out whose it is. This is the single highest-impact finding of the session.
**Files:** `apps/web-frontend/src/pages/sales/QuotationsPage.tsx:110`, `InvoicesPage.tsx:104`, `PaymentsPage.tsx:66`, `SaleReturnsPage.tsx:42`, plus `QuotationDetailPage.tsx` / `InvoiceDetailPage.tsx`; backend `apps/sales-service` quotation/invoice GET routes.

### 3. [MAJOR] Branch auto-default on New Customer form is invisible, making a required field look broken

**Repro:** Log in as a user assigned to exactly one branch (e.g. OWNER, whose JWT `branchIds` = `[1]` "Head Office" even though the tenant has 3 branches total: Head Office, QA E2E Branch, Debug Branch). Go to Customers → New Customer. Fill in Display Name/Type/Phone but do not touch the Branch dropdown. Submit.
**Expected:** Either the dropdown visibly shows the defaulted branch selected, or (if truly required) submission is blocked until the user picks one.
**Actual:** The Branch `<select>` visually still shows the placeholder "Select branch…" (looks empty/unselected, red asterisk implies required), yet the customer is created successfully (201) with `branchId: 1` silently included in the payload. Confirmed via network capture — the form's internal state is correct, but the on-screen `<select>` never reflects it, because the auto-default `setValue()` call runs before the branch `<option>` elements exist in the DOM (branches load async). Manual selection of a different branch (tested: "QA E2E Branch", id 6) works correctly and overrides the default properly, so this is a display-only bug for the single-branch-user default path, not a general breakage.
**Impact:** A required field silently appears to skip its own validation — very confusing for anyone auditing "did I set this correctly," and specifically risky for staff who are assigned to a non-Head-Office branch but get auto-defaulted (correctly, just invisibly) without realizing it.
**File:** `apps/web-frontend/src/pages/customers/CustomerFormPage.tsx:75-77` (`setValue('branchId', ...)` effect racing the branches query).

### 4. [MAJOR] Customer Detail page has no outstanding balance / statement anywhere

**Repro:** Customers → open any customer (e.g. "Ramesh Textiles", the tenant's top customer by revenue at ₹1.80L).
**Expected:** Some visible "Outstanding / Amount Due" figure, or a link to a statement, given the dashboard tracks a tenant-wide "Total Receivable" (₹21.0K) and the backend RBAC includes a `CUSTOMER_STATEMENT_VIEW` permission.
**Actual:** The Details tab shows Credit Limit, Credit Days, Opening Balance, Loyalty Points — but no running/outstanding balance field, and there is no "Statement" tab, route, or page anywhere in the app (grepped the full frontend source for "statement" — zero matches outside the unused permission constant). A user managing a customer relationship has no way to see "what do they currently owe me" from the customer's own page.
**File:** `apps/web-frontend/src/pages/customers/CustomerViewPage.tsx` (no statement UI); permission `CUSTOMER_STATEMENT_VIEW` exists in RBAC but has no consuming frontend surface anywhere.

### 5. [MODERATE] Onboarding checklist widget blocks clicks on underlying page content

**Repro:** As a fresh browser profile / new user (localStorage key `erp_onboarding_completed` empty), navigate to any form with the primary action button in the bottom-right (e.g. Customers → New Customer). Do not dismiss the floating "Get Started — Setup Checklist" panel. Click "Create Customer".
**Expected:** Click reaches the button.
**Actual:** Playwright's click retried for the full 30s timeout and failed — the fixed `bottom-4 right-4 z-40` checklist panel intercepts pointer events on whatever sits underneath it, including the form's submit button. This will affect real users on their very first session (before they think to dismiss/collapse the widget), on any page where a primary action sits near the bottom-right. Once manually dismissed it doesn't recur (persisted to localStorage), so it's a first-session-only trap, but that's exactly when a paying customer would be evaluating the product.
**File:** `apps/web-frontend/src/components/help/OnboardingChecklist.tsx:107` (`fixed bottom-4 right-4 z-40`).

### 6. [MINOR] Dashboard pie charts render as malformed clipped shapes, not circles

**Repro:** Home/Dashboard, scroll to "Sales by Category" and "Payment Modes" cards.
**Expected:** A normal pie/donut chart with legend and category breakdown.
**Actual:** Both render as a flat-topped dome/half-moon shape with no visible legend, labels, or percentages — clearly a broken render, not a design choice. Reproducible every load. API data itself is fine (`salesByCategory: [{category: null, revenue: "199500.00"}]`, `paymentModes: [{mode: "CASH", total: "149100.00"}]` — single-entry 100%-share data, which may be what's triggering a recharts/container-sizing edge case).
**File:** `apps/web-frontend/src/pages/DashboardPage.tsx` (Pie/ResponsiveContainer blocks around lines 329-350 and 369-388).
**Side note (not a bug, a data-completeness gap):** `salesByCategory`/`stockByCategory` both come back with `category: null` because none of this tenant's items have a category assigned (`LEFT JOIN categories` in `report-service/src/api/dashboard.routes.ts`) — worth a data backfill, and the frontend should label a null category as "Uncategorized" rather than leaving it blank.

### 7. [MINOR] Dashboard KPI widgets disagree with each other on overdue receivables

**Repro:** Home/Dashboard, compare the "Sales Workflow" row ("OVERDUE INVOICES: 0") against the "Action Required" row directly below it ("1 overdue receivables ₹1.1K"), visible on the same page load.
**Actual:** Two different widgets, two different overdue counts, no obvious reason for the tenant to have both "0 overdue" and "1 overdue" true at once. Likely different query definitions of "overdue" (e.g. one using `/api/report/api/v2/dashboard/kpis`, the other `/api/report/api/v2/dashboard/alerts`) that have drifted out of sync.

### 8. [MINOR] Notification SSE stream is permanently unauthorized

**Repro:** Load any page while logged in; check console/network.
**Actual:** `GET /api/notification/notifications/stream?token=...` returns 401 Unauthorized on every single page load throughout the entire session (reproduced dozens of times, never once succeeded). If this is the transport for live in-app notifications/toasts, that feature is silently dead for every user, all the time — separate from (and probably a duplicate finding vs.) any earlier notification-related bugs from prior sessions; flagging since it was 100% reproducible here.

### 9. [MINOR] Customer/item search combobox fires a needless empty-query request on every use

**Repro:** Anywhere with a type-ahead combobox (confirmed on the invoice form's Customer field): click into the field, then type.
**Actual:** Before the debounced typed value goes out, the component fires a search request with `q=` (empty string), which the backend correctly rejects with `400 VALIDATION_ERROR: "q: String must contain at least 1 character(s)"`. The subsequent real-query request succeeds and results appear fine, so this is functionally harmless, but it's a guaranteed console error on every single search interaction across the app (likely a shared Combobox component, so probably present on every other type-ahead field too — item search, etc.). Cheap to fix (guard the initial fetch on non-empty query) and worth it for console hygiene / not looking broken during a demo.

---

## What was verified working cleanly

- **Login**: tenant-ID login flow (Tenant 2 / owner@qa-e2e.local) works correctly end-to-end.
- **Dashboard**: KPI tiles (Today's Sales/Collection/Purchase/Expense, Month Sales/Collection/Profit/Invoices, Total Receivable/Payable), Sales Trend chart, Purchase Trend chart, Receivables Ageing bar chart, Top Customers list, Stock Value by Category bar chart — all render real data with no console/network errors (aside from the SSE issue above).
- **Customers list**: loads real seed data (7+ customers visible), search-by-name filters correctly in real time, searching a nonexistent name correctly shows a "No records" empty state, columns (Code/Name/GSTIN/Type/Status/Credit Limit) render correctly.
- **Customer creation (valid data path)**: full create flow succeeds (201 Created) with correct payload shape; toast/redirect-to-list behavior works.
- **Customer form validation**: empty-submit correctly shows inline errors for Display Name ("Must be at least 2 characters"), Customer Type ("Required"), Phone ("Phone must be at least 10 digits") with red borders — good UX, just missing the Branch case (see bug 3).
- **Customer detail view**: renders correctly for an existing customer (Ramesh Textiles) — Phone, Email, GSTIN, PAN, Type, Status, Credit Limit, Credit Days, Opening Balance, Loyalty Points, Communication Preferences all present and correctly formatted.
- **Quotations list**: existing seed data (8+ quotations, all status CONVERTED) renders correctly aside from the customer-name issue (bug 2).
- **Invoice creation form**: customer search-combobox, branch/warehouse selects, date pickers, item search-and-add, and the line-item totals table all function correctly for the happy path.
- **Invoice tax calculation, happy path**: Cotton Saree, qty 1, price ₹1000, GST 5% (same-state → CGST 2.5% + SGST 2.5%) computed Taxable ₹1000.00 / CGST ₹25.00 / SGST ₹25.00 / Grand Total ₹1050.00 — correct math, correct same-state CGST/SGST split.
- **Invoice decimal quantity**: qty 2.5 correctly computed Grand Total ₹2,625.00 (2.5 × 1000 × 1.05) — decimals work correctly, not a bug.
- **Invoice large quantity**: qty 999,999,999 computed without overflow/NaN (₹1,049,999,998,950.00) — arithmetic is sound even at extreme values, though there's no sanity-limit validation to catch an obvious data-entry typo (minor, not writing up as a separate bug).
- **Delivery Challans list (empty state)**: correctly renders "No records yet — Get started by creating your first record" when the tenant has zero challans; no console/network errors.

---

## Not reached this session (interrupted before completion — do not assume tested)

- Delivery Challan creation flow (form fields, save, detail view) — only the empty list state was confirmed working. Prior sessions noted this area got less historical QA attention; **recommend prioritizing this first in a follow-up pass.**
- Quotation → Invoice conversion (live create-and-convert; only viewed an already-converted historical quotation).
- Recording a payment against an invoice and verifying the customer's outstanding balance updates correctly end-to-end.
- Sale Return creation against a freshly-created invoice (only viewed existing historical returns list).
- Customer edit flow, customer delete/deactivate flow.
- Invoice/Quotation/Payment/Return validation edge cases beyond what's listed above (invalid email/phone/GSTIN formats, huge discount %, pagination beyond page 1, sorting).
- Whether the backend actually rejects or accepts a negative-quantity invoice on save (client-side had zero guard, per bug 1; never got to click Save on that state).

---

## Severity summary

- MAJOR: 4 (negative-qty validation gap, raw-ID display across Sales lists+details, invisible branch auto-default, missing customer balance/statement)
- MODERATE: 1 (onboarding checklist blocks clicks)
- MINOR: 4 (dashboard pie chart rendering, dashboard KPI disagreement, dead notification SSE stream, needless empty-query search request)
