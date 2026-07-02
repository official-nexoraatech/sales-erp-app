# UAT Test Scenarios — Go-Live Sign-Off Checklist
## All 40 scenarios must pass before go-live

**UAT Environment:** http://uat.erp.nexoraa.com  
**Tester:** Business Owner / Team Lead  
**Sign-Off By:** _____________________ Date: _____________________

---

## Instructions

1. Log in with the appropriate role for each scenario (role shown in square brackets).
2. Mark each scenario **PASS** or **FAIL**.
3. For FAIL: note the steps that failed and the error message seen.
4. All 40 must be PASS before the business owner signs off.

---

## Module 1 — Customers & GST

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 1 | Create customer with GSTIN | [OWNER] | Masters → Customers → New → enter 15-char GSTIN → Save | GSTIN validated, customer saved with GST number | ☐ PASS ☐ FAIL | |
| 2 | Create B2B intrastate invoice | [CASHIER] | New Invoice → B2B customer (same state) → Add item → Confirm | GST split as CGST + SGST (each 50% of GST %) | ☐ PASS ☐ FAIL | |
| 3 | Create B2B interstate invoice | [CASHIER] | New Invoice → B2B customer (different state) → Confirm | GST applied as IGST (full GST %) | ☐ PASS ☐ FAIL | |

---

## Module 2 — Sales & Inventory

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 4 | Invoice with 3 items → stock deducted | [CASHIER] | Create invoice with 3 line items → Confirm → check stock | Each item's stock reduced by invoiced quantity | ☐ PASS ☐ FAIL | |
| 5 | Invoice above credit limit → blocked | [CASHIER] | Create invoice for customer at 100% of credit limit → try to Confirm | Invoice blocked with "Credit limit exceeded" error | ☐ PASS ☐ FAIL | |
| 6 | Credit limit override | [SALES_MANAGER] | Same invoice as above → Override credit limit | Invoice proceeds with override, audit log records override | ☐ PASS ☐ FAIL | |
| 7 | Invoice payment → outstanding reduced | [CASHIER] | Record payment for invoice → check customer outstanding | Customer balance reduced by payment amount | ☐ PASS ☐ FAIL | |
| 8 | Sale return → stock restored | [CASHIER] | Create sale return against invoice → Confirm | Stock restored, credit note created | ☐ PASS ☐ FAIL | |
| 9 | Credit note applied to future invoice | [ACCOUNTANT] | Apply credit note from above against a new invoice | Invoice net payable reduced by credit note amount | ☐ PASS ☐ FAIL | |

---

## Module 3 — POS

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 10 | POS barcode scan → item found in <1 sec | [CASHIER] | POS terminal → scan barcode or enter barcode number | Item found and added to bill within 1 second | ☐ PASS ☐ FAIL | |
| 11 | POS split payment (cash + UPI) | [CASHIER] | Complete POS sale → Payment → split ₹500 cash + ₹500 UPI | Both payments recorded, correct split shown on receipt | ☐ PASS ☐ FAIL | |

---

## Module 4 — Purchase

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 12 | Create PO → approve → GRN → stock added | [PURCHASE_MANAGER] | New PO → Submit → Approve → Create GRN → Confirm | Stock added to warehouse with correct quantity | ☐ PASS ☐ FAIL | |
| 13 | GRN with price variance → approval triggered | [PURCHASE_MANAGER] | GRN with rate 6% higher than PO rate | Approval workflow triggers, GRN in Pending Approval state | ☐ PASS ☐ FAIL | |
| 14 | Supplier payment → outstanding reduced | [ACCOUNTANT] | Record supplier payment → check supplier balance | Supplier outstanding reduced by payment amount | ☐ PASS ☐ FAIL | |

---

## Module 5 — Inventory

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 15 | Stock transfer between branches | [OWNER] | Inventory → Stock Transfer → From Branch 1 to Branch 2 → Confirm | Stock deducted from Branch 1, added to Branch 2 | ☐ PASS ☐ FAIL | |
| 16 | Physical verification → variance → adjustment | [OWNER] | Inventory → Physical Verification → enter physical count different from system → Finalize | Variance shown, stock adjustment created automatically | ☐ PASS ☐ FAIL | |

---

## Module 6 — HR & Alterations

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 17 | Alteration order lifecycle | [CASHIER] | Alteration → Receive → Assign tailor → Mark Ready → Customer collects → Delivered | Full lifecycle completed, each status change recorded | ☐ PASS ☐ FAIL | |
| 18 | Employee payroll: attendance → calculate → approve → slips | [OWNER] | HR → Payroll → Import attendance → Calculate → Approve → Generate slips | Salary slips generated for all employees, PDF downloadable | ☐ PASS ☐ FAIL | |

---

## Module 7 — GST Returns

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 19 | GSTR-1 export matches invoice register total | [ACCOUNTANT] | GST → GSTR-1 → Select period → Export | Total taxable value in GSTR-1 matches Sales report for same period (within ₹1) | ☐ PASS ☐ FAIL | |
| 20 | GSTR-3B shows correct ITC amount | [ACCOUNTANT] | GST → GSTR-3B → Select period | ITC value matches total GST on purchase GRNs for the period | ☐ PASS ☐ FAIL | |

---

## Module 8 — Accounting

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 21 | Bank reconciliation | [ACCOUNTANT] | Accounting → Bank Recon → Import statement → Auto-match → Finalize | Matched entries removed from unreconciled list, balance matches bank statement | ☐ PASS ☐ FAIL | |
| 22 | Year-end close | [OWNER] | Accounting → Year End → Run checklist → Close financial year | New FY opens, previous FY locked for posting | ☐ PASS ☐ FAIL | |
| 23 | Trial balance balances | [ACCOUNTANT] | Reports → Trial Balance → Select date | Total DR = Total CR exactly | ☐ PASS ☐ FAIL | |

---

## Module 9 — Dashboard & Reports

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 24 | Dashboard: all KPIs show today data | [OWNER] | Login → Dashboard | Today's sales, collections, outstanding all show correct numbers (verify against known invoice) | ☐ PASS ☐ FAIL | |
| 25 | Sales by Customer report | [OWNER] | Reports → Sales → By Customer → Last month | Total matches sum of invoices for that customer in same period | ☐ PASS ☐ FAIL | |
| 26 | Outstanding receivables aging | [ACCOUNTANT] | Reports → Receivables → Aging | Customers shown in correct 0–30, 31–60, 61–90, 90+ buckets | ☐ PASS ☐ FAIL | |

---

## Module 10 — Import / Export

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 27 | Import 100 customers from Excel | [OWNER] | Masters → Customers → Import → Upload Excel | Import completes, error report shows invalid rows, valid rows imported | ☐ PASS ☐ FAIL | |
| 28 | Export customer list to Excel | [OWNER] | Masters → Customers → Export | Excel file downloads, opens correctly in Microsoft Excel | ☐ PASS ☐ FAIL | |

---

## Module 11 — Concurrency & Permissions

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 29 | Concurrent invoice creation → no stock conflict | [OWNER] | Ask 2 cashiers to simultaneously invoice the last unit of same item | Exactly 1 succeeds, other gets "Insufficient stock" error | ☐ PASS ☐ FAIL | |
| 30 | Cashier cannot access payroll | [CASHIER] | Login as cashier → try to navigate to HR → Payroll | Access denied (403) or menu not visible | ☐ PASS ☐ FAIL | |
| 31 | Accountant cannot create users | [ACCOUNTANT] | Login as accountant → try to navigate to Settings → Users → Add | Access denied (403) or button not visible | ☐ PASS ☐ FAIL | |

---

## Module 12 — UI / UX

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 32 | Dark mode: entire app works | [OWNER] | Settings → Toggle dark mode → Browse all main screens | All screens readable, no white text on white background | ☐ PASS ☐ FAIL | |
| 33 | Mobile: dashboard usable on phone | [OWNER] | Open http://uat.erp on phone browser | Dashboard renders, KPI cards visible, no horizontal scroll required | ☐ PASS ☐ FAIL | |

---

## Module 13 — Notifications

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 34 | WhatsApp: invoice confirmed → notification sent | [CASHIER] | Confirm invoice for customer with WhatsApp number | Customer receives WhatsApp message within 2 minutes | ☐ PASS ☐ FAIL | |
| 35 | Email: scheduled report arrives in inbox | [OWNER] | Settings → Scheduled Reports → Add daily sales report | Email arrives in owner inbox at scheduled time | ☐ PASS ☐ FAIL | |

---

## Module 14 — Documents

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 36 | PDF: invoice PDF has QR code, GSTIN, all fields | [CASHIER] | View confirmed invoice → Download PDF | PDF has: company logo, GSTIN, IRN QR code (if e-invoice enabled), all line items, GST breakup | ☐ PASS ☐ FAIL | |
| 37 | Barcode: label PDF prints correctly | [CASHIER] | Items → Select item → Print barcode label | Barcode label PDF opens with correct EAN-13/Code128 barcode | ☐ PASS ☐ FAIL | |

---

## Module 15 — Platform Features

| # | Scenario | Role | Steps | Expected Result | Status | Notes |
|---|----------|------|-------|-----------------|--------|-------|
| 38 | Feature flag: disable loyalty → tab disappears | [OWNER] | Settings → Feature Flags → Disable Loyalty module | Loyalty tab disappears from customer profile immediately | ☐ PASS ☐ FAIL | |
| 39 | Campaign: SMS campaign to customer segment | [OWNER] | CRM → Campaigns → New SMS → Select segment → Send | SMS sent to customers in segment, delivery report shows count | ☐ PASS ☐ FAIL | |
| 40 | Forgot password: OTP → reset | [CASHIER] | Logout → Forgot Password → enter email → OTP received → set new password | OTP received on email/SMS, password changed, login succeeds with new password | ☐ PASS ☐ FAIL | |

---

## Summary

| Total Scenarios | Passed | Failed | Blocked |
|-----------------|--------|--------|---------|
| 40 | | | |

**GO-LIVE DECISION:**

☐ ALL 40 PASS → Proceed to go-live (sign below)  
☐ 1–3 FAIL with workaround → Conditional go-live (document P1 items, fix within 48 hours)  
☐ 4+ FAIL or any P0 FAIL → Postpone go-live, fix and re-test

**Business Owner Sign-Off:**

Name: _________________________________ Date: ____________________

Signature: _____________________________

---

*Generated by: ERP Phase 14 | Date: 2026-07-01*
