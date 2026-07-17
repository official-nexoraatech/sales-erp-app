# QA Regression: GST + Accounting — 2026-07-17

Scope: GST Register/GSTR-1/3B/9/e-Invoice/GSTR-2A/Compliance Calendar + Accounting (Chart of Accounts, Opening Balances, Journals, Trial Balance, P&L, Balance Sheet, Cash Flow, Bank Reconciliation, Financial Years, Fixed Assets, TDS, Cost Centers).

Method: live browser (Playwright) against http://localhost:5173 + direct API calls (via page context, using the logged-in JWT) against http://localhost:3000, on tenant 2 ("QA E2E Test Co"), OWNER role. Scripts left in `apps/web-frontend/.qa-tmp/ga-*.mjs` (throwaway, not committed).

**Note on time:** this session ran long and was cut short before finishing the full checklist (Fixed Assets depreciation run, Cost Centers, Opening Balances wizard, e-Invoice generation, GSTR-2A reconciliation, Compliance Calendar were not exercised beyond a page-load smoke check). See "Not fully tested" section at the end.

---

## BLOCKER

### B1. Invoice-confirmation journal postings silently drop ALL GST tax lines (CGST/SGST/IGST Payable never booked; Trade Debtors under-debited)

**Repro:**

1. Create a sales invoice: customer "Ramesh Textiles", item "Cotton Saree" (5% GST, ₹1000/unit) × 10 = taxable ₹10,000, CGST ₹250, SGST ₹250, grand total ₹10,500 (intrastate, Maharashtra→Maharashtra).
2. Confirm the invoice (→ invoice id 107, `INV-GA-QA-1784260916950`).
3. Fetch the resulting journal via `GET /api/accounting/journals` (note: list endpoint's page-size param is `size`, not `pageSize` — `pageSize` is silently ignored and falls back to a small default, which caused me to initially believe journals were missing entirely; they weren't, just paginated past page 1 with the wrong param name — false alarm, mentioning in case it trips someone else).
4. Journal `01KXQ3SYZ9G25YJHPXVK1BT5C7` ("Invoice INV-GA-QA-... confirmed") lines:
   ```
   4000 Sales Revenue          DR 0.00       CR 10000.00
   1120 Trade Debtors—Wholesale DR 10000.00  CR 0.00
   ```

**Expected:** DR Trade Debtors 10,500 / CR Sales Revenue 10,000 / CR CGST Payable 250 / CR SGST Payable 250 (still balanced, but capturing the tax liability and the true amount owed).

**Actual:** Only the taxable amount moves. CGST/SGST (₹500 total) never touch the ledger — no CGST Payable / SGST Payable lines exist anywhere in the books. This is **not an isolated incident** — every INVOICE-confirmed journal I sampled (ids 14, 18, 20, 46, 128, spanning 2026-07-12 through 2026-07-17) shows the identical pattern: only the taxable amount posted, zero tax lines, regardless of invoice date or session.

Confirmed via Trial Balance API: `CGST Payable` (2210) and `SGST Payable` (2220) both show `periodDebits: 0, periodCredits: 0, closingDebit: 0, closingCredit: 0` — i.e. ₹0 forever, despite GSTR-9 (a separate data path, see "confirmed still fixed" below) correctly showing real CGST/SGST liability for the same period. **The books of account and the GST returns are built from two disconnected data sources, and only one of them records tax liability.** A business relying on the Balance Sheet/Trial Balance to know what GST they owe would see nothing.

**Root cause (identified via code read, not fixed):**

- Producer `apps/sales-service/src/domain/InvoiceService.ts:619-643` builds the `INVOICE_CONFIRMED` outbox payload with `taxableAmount`, `cgstAmount`, `sgstAmount`, `igstAmount`, `placeOfSupply`, and a correctly pre-computed `isInterstate` — but never includes `sellerStateCode`.
- Consumer `apps/accounting-service/src/consumers/InvoiceAccountingConsumer.ts:9-39` declares `sellerStateCode?: string` on the payload type but the producer never sends it, then **ignores the producer's `isInterstate` field** and recomputes its own: `const isInterstate = p.placeOfSupply !== p.sellerStateCode;` (line 39). Since `sellerStateCode` is always `undefined`, this is `true` for every single invoice, intrastate or not.
- `apps/accounting-service/src/domain/PostingMatrixService.ts:208-225`: the CGST/SGST branch (`if (!ctx.isInterstate && ...)`) never fires because `isInterstate` is wrongly `true`; the IGST branch does fire but `igstAmount` is 0 for an intrastate sale, so it's a no-op. Net effect: no tax lines ever get built, for any invoice, regardless of actual state. The main posting line only ever moves `taxableAmount`, never `grandTotal`.
- This is the same "outbox payload truncation" pattern noted in earlier sessions (producer writes fewer fields than the consumer's type declares/expects) — see prior memory note.

**Fix direction (not applied, investigation only per instructions):** consumer should use `p.isInterstate` from the payload directly, or the producer should populate `sellerStateCode`.

**Severity:** Blocker. Silently understates GST liability and receivables on every invoice in the system, industry-wide compliance/audit risk, and has apparently been broken since at least 2026-07-12 (5+ days, ~60+ invoices affected on this tenant alone) without detection because Trial Balance still "balances" (both sides are wrong by the same missing amount, so the balance check gives false confidence).

---

## MAJOR

### M1. Balance Sheet shows negative total Assets / negative Cash / negative Inventory, yet reports "balances"

On 2026-07-17, `GET /api/accounting/reports/balance-sheet?asOf=2026-07-17`:

- Assets total: **-₹8,21,848.21**, Liabilities+Equity: **-₹8,21,848.21** — UI shows a green "✓ Balance sheet balances" banner because the two sides are numerically equal, but a real business cannot have negative total assets.
- `Cash in Hand` (1010): balance **-₹8,59,878.00** (a cash account sitting in a credit/negative position — you can't spend cash you don't have; periodCredits 945,978 vs periodDebits 86,100 per Trial Balance).
- `Inventory` (1200): balance **-₹23,870.21** to -25,707.81 (moved during this session, likely other concurrent QA agents' actions on the shared tenant).

This tenant has ~130 journal entries accumulated across many prior QA sessions (manual "opening cash adjustment" test journals ×9, dozens of POS/invoice test transactions, payroll runs, etc.), so some of this is expected pollution from repeated testing on a shared, non-reset tenant rather than a single new bug. However, cash and inventory both going deeply negative is also consistent with — and likely compounded by — bug B1 (tax amounts never debited to Debtors means every cash _receipt_ against an invoice, if it collects the full grand-total including tax, over-credits Debtors relative to what was ever booked as owed, potentially cascading into other imbalances elsewhere in the flow). Flagging for a developer to determine how much is "dirty shared-tenant data" vs. a genuine second bug; recommend re-testing on a clean tenant once B1 is fixed.

**Severity:** Major (the "balances" check gives false confidence when the underlying numbers are nonsensical).

### M2. TDS Form 26Q endpoint 500s

`GET /api/accounting/tds/26q?year=2026&quarter=1` → HTTP 500, reproduced twice (fresh sessions). TDS page (`/accounting/tds`) loads its shell fine but this specific report call fails every time. No stack trace visible client-side; needs backend log inspection to pin down (likely accounting-service, `apps/accounting-service`, TDS/26Q route).

**Severity:** Major (a whole statutory report is unusable).

---

## MINOR / NEEDS FOLLOW-UP

### N1. GST Register page summary cards show ₹0.00 while the underlying data is non-zero

On `/gst/register` with Period = July 2026, Type = All Entries: the "Sales" and "Purchases" summary tiles both render ₹0.00, while the table immediately below lists real ₹35,000 PURCHASE entries for that same period, and the underlying API (`GET /api/gst/gst/summary?period=2026-07`) independently returns correct non-zero figures (sales taxable 98,000 / CGST 2,450 / SGST 2,450; purchases taxable 455,000 / CGST 11,375 / SGST 11,375). This points to a frontend wiring bug on the summary cards specifically (possibly a period-format mismatch between the register-list call and the summary call, or the cards reading the wrong response shape) rather than a backend data problem. Did not get time to pin down the exact frontend file — flagging for someone to grep `GstRegisterPage` for how it computes/binds the summary tiles vs. the `gstApi.getSummary`-style call.

**Severity:** Minor/cosmetic on its own (the register table itself is correct, and GSTR-9 pulls correct numbers independently), but worth fixing since it's the first thing an owner looks at.

### N2. Two side-observations outside this scope (Sales module), noted in passing while creating a test invoice:

- New Invoice page fires `GET /api/search/search?q=&entity=customer&size=20` with an empty query on page load → HTTP 400, console error, before the user has typed anything.
- Invoice detail page displays "Customer 1" instead of the customer's actual name ("Ramesh Textiles") in the header.
  Both are Sales-module UI, not this session's scope — flagging so the Sales-focused QA session doesn't miss them if not already found.

---

## CONFIRMED STILL WORKING (regressions checked, none found)

- **GSTR-9 nil-rated misclassification bug (prior fix): still fixed.** `/gst/gstr9` for FY2026-27, Table 4 (Taxable Outward Supplies) shows real classified revenue: Taxable Value ₹88,000, CGST ₹2,200, SGST ₹2,200, Total ₹4,400 (5% effective rate = 2.5%+2.5%). Table 5 (Nil-rated/Exempt) correctly shows ₹0.00 — revenue is NOT being dumped into nil-rated anymore.
- **Trial Balance midnight-cutoff / always-zero bug (prior fix): still fixed.** `/accounting/reports/trial-balance` as-of 2026-07-17 shows real non-zero figures across accounts (e.g. Trade Debtors — Wholesale closing debit ₹11,900; Cash in Hand periodDebits ₹86,100) and displays "✓ Trial balance is balanced" with Total DR = Total CR (₹9,71,748.21 at time of first check).
- **"No way to create a Financial Year" bug (prior fix): still fixed** — at least a Financial Year now exists and is usable: FY2026-27 is OPEN and marked Current (01 Apr 2026 – 31 Mar 2027), with "Run Checklist" / "Close Year" actions present on `/accounting/financial-years`. (Did not personally exercise the "+ New Financial Year" creation flow this session — see gaps below — but the page and existing record are clearly functional, consistent with the fix holding.)
- **Journal double-entry balancing (B1 aside):** every journal I inspected — including the flawed invoice-confirm ones — has DR always equal to CR within itself (e.g. COGS journal: DR Cost of Goods Sold 1,837.60 / CR Inventory 1,837.60; Payment journal: DR Cash 5,250 / CR Trade Debtors 5,250). The bug in B1 is a missing set of lines, not an unbalanced entry — every journal that does post is internally balanced.
- **Kafka/tenantId propagation into accounting journal-posting (prior crash-loop bug): confirmed working** — invoice-confirm and COGS journals are posting for tenant 2 in near-real-time (my test invoice's journal posted correctly seconds after confirming), so the consumer pipeline itself is healthy; the tax-line gap (B1) is a data-mapping bug in the payload, not a pipeline/connectivity failure.
- Full sweep of all 8 GST pages + 12 Accounting pages: zero uncaught console/page errors or unhandled HTTP failures except the TDS 500 (M2) — no `.map is not a function`, no blank crash screens, no infinite skeleton loaders once given ~1.8s to load.

---

## NOT FULLY TESTED (ran out of time this session — flag for a follow-up pass)

- Fixed Assets: page loads, empty state ("No fixed assets registered", 0 assets, ₹0.00 NBV) renders cleanly with working "Run Depreciation" / "+ Add Asset" buttons visible, but did **not** create an asset or run depreciation to verify the calculation.
- Bank Reconciliation: page loads, empty state (0 Bank Items / 0 Book Items / 0 Matched / 0 Unmatched, trivially "all matched") renders cleanly, but did **not** import a statement or match a real transaction.
- Cost Centers, Opening Balances wizard, e-Invoice (IRN) generation, GSTR-2A Reconciliation, Compliance Calendar: only smoke-tested (page loads, no console errors) — no CRUD/workflow exercised.
- Cash Flow and P&L reports: loaded cleanly with real (non-zero) figures visible (P&L: Net Revenue ₹88,000 for 1 Apr–17 Jul 2026 period, before my B1-affected test invoice), but I did not cross-check P&L net profit against Balance Sheet retained-earnings movement number-for-number.
- Chart of Accounts, Opening Balances, Journal Entries list/detail pages: loaded cleanly, journal list/detail browsing works (used extensively for this investigation), but did not test creating/editing a Chart of Accounts entry or the Opening Balances lock flow this session.

Recommend a follow-up pass once B1 is fixed, to re-verify Balance Sheet sanity (M1) on a clean tenant and finish the untested items above.
