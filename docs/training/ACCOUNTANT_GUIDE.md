# ERP Training Guide — ACCOUNTANT
## Version 1.0 | Cloth Retail ERP

> **Time to complete:** ~115 minutes across 5 modules  
> **Critical rule:** Never post to a closed financial period. Always verify trial balance before filing GST returns.

---

## Module 1: Payment Recording and Allocation (15 min)

### Recording a Customer Payment

1. **Sales → Payments → Receive Payment**
2. Select **Customer** (search by name or phone)
3. The outstanding invoices list appears automatically
4. Enter **Amount Received**
5. Select **Payment Mode:**
   - Cash, UPI, Card — immediate clearance
   - Cheque — requires deposit tracking (see below)
   - NEFT/RTGS/IMPS — enter the UTR number as reference
6. **Allocate to invoices:**
   - Oldest First (recommended) — automatically ticks the oldest unpaid invoices
   - Manual — tick specific invoices
7. Click **Confirm**

**Double-entry posted automatically:**
- Dr: Cash/Bank Account
- Cr: Accounts Receivable (Customer Account)

### Cheque Tracking Workflow
| Stage | Action |
|-------|--------|
| Received from customer | Record payment → mode = Cheque |
| Deposited at bank | Accounting → Cheques → Mark Deposited |
| Bounced | Accounting → Cheques → Mark Bounced → system reverses the payment |

### Recording a Supplier Payment

1. **Purchase → Payments → Make Payment**
2. Select **Supplier**
3. Outstanding purchase invoices appear
4. Enter amount and payment mode
5. Allocate to invoices
6. Click **Confirm**

**Double-entry:**
- Dr: Accounts Payable (Supplier Account)
- Cr: Cash/Bank Account

### Advance Payments
If you pay a supplier in advance before receiving goods:
1. Record as **Advance** (toggle in payment form)
2. When GRN arrives, apply the advance: Purchase → GRN → Apply Advance

---

## Module 2: Bank Reconciliation (20 min)

Bank reconciliation matches your bank statement with ERP entries.

### Step 1 — Import Bank Statement
1. **Accounting → Bank Reconciliation**
2. Select **Bank Account**
3. Click **Import Statement**
4. Upload the bank statement as Excel or CSV (download from your bank's internet banking)
5. System reads transactions from the file

### Step 2 — Auto-Match
1. Click **Auto-Match**
2. System matches transactions by:
   - Amount + Date (within 3 days)
   - Reference number (UTR, cheque number)
3. Matched entries turn **green** (✅)
4. Unmatched entries remain **yellow** (⚠️)

### Step 3 — Manual Match
For unmatched entries:
- Bank has transaction not in ERP → Create the ERP entry now
- ERP has transaction not in bank → It may be outstanding cheque (expected)
- Select the bank transaction + ERP entry → Click **Match**

### Step 4 — Finalize
1. Verify **Closing Balance in ERP = Closing Balance in Bank Statement**
2. Click **Finalize Reconciliation**
3. All matched entries are locked

### Common Reconciliation Items
| Bank Item | ERP Action |
|-----------|-----------|
| Bank charges | Create journal: Dr Bank Charges, Cr Bank Account |
| Interest earned | Create journal: Dr Bank Account, Cr Interest Income |
| Bounced cheque | Mark cheque as Bounced in Cheques module |
| Uncleared cheque | Leave as outstanding — will appear next month |

---

## Module 3: GST Returns — GSTR-1 and GSTR-3B (30 min)

### GSTR-1 (Monthly Sales Return — due 11th of next month)

**What it contains:** All B2B invoices (with GSTIN), B2C summary, exports, debit/credit notes.

**Step 1 — Verify the period's invoices**
1. **GST → GSTR-1 → Select Period** (e.g., June 2026)
2. Review the summary table:
   - B2B Invoices count and taxable value
   - B2C summary
   - Total CGST, SGST, IGST
3. Cross-check against **Reports → Sales → By Period** for same dates

**Step 2 — Fix any issues**
- Missing GSTIN for a B2B customer → update customer master
- Wrong HSN code → correct the item master and re-run
- Cancelled invoice still showing → verify it has status CANCELLED

**Step 3 — Export**
1. Click **Export GSTR-1**
2. Download formats: Excel (for review) or JSON (for GSTN portal upload)
3. Upload the JSON on the GST portal: [https://www.gst.gov.in](https://www.gst.gov.in)

### GSTR-3B (Monthly Summary Return — due 20th of next month)

**What it contains:** Summary of outward supplies, ITC claimed, net tax payable.

1. **GST → GSTR-3B → Select Period**
2. System auto-populates:
   - **3.1 — Outward supplies:** From your confirmed invoices
   - **4A — ITC on purchases:** From your GRNs with GST
3. Review key figures:
   - **Tax payable (3.1 total)** = Your GST liability
   - **ITC available (4A total)** = GST paid on purchases
   - **Net tax payable** = 3.1 minus 4A
4. Click **Export GSTR-3B** → Download Excel
5. File on GST portal and pay the net tax amount

### GSTR-2A Reconciliation (ITC Verification)
1. Download GSTR-2A from the GST portal for the period
2. **GST → 2A Reconciliation → Upload GSTR-2A**
3. System compares supplier invoices (filed by suppliers) with your purchase entries
4. Differences may mean: supplier has not filed, or wrong GSTIN entered

---

## Module 4: Year-End Close (30 min)

**This is irreversible. Do not proceed unless all month-end tasks for March are complete.**

### Pre-Close Checklist (complete all before closing)
- [ ] All sales invoices for March confirmed (no drafts pending)
- [ ] All purchase GRNs for March entered
- [ ] Bank reconciliation for March finalized
- [ ] All outstanding payments for March recorded
- [ ] GSTR-1 for March filed
- [ ] GSTR-3B for March filed
- [ ] Trial balance shows DR = CR exactly

### Running the Year-End Close
1. **Accounting → Year End → Year-End Checklist**
2. Run each checklist item — each shows ✅ or ❌
3. Fix any ❌ items before proceeding
4. When all items are ✅, click **Initiate Year-End Close**
5. Owner approval is required (system sends approval request)
6. After approval: click **Close Financial Year**

### What Happens After Close
- The old FY is **locked** — no new invoices can be posted to it
- A **new FY opens** automatically (April–March)
- **Opening balances** carry forward:
  - Customer outstanding → opening receivables
  - Supplier outstanding → opening payables
  - Stock on hand → opening stock
  - Bank balances → opening bank
- Retained Profit/Loss → transferred to **Capital Account**

### Post-Close Tasks
1. Verify opening balances of new FY match closing balances of old FY
2. Share the **Trial Balance, P&L, and Balance Sheet** (PDF) with owner
3. Archive the previous FY reports

---

## Module 5: Financial Reports (20 min)

### Trial Balance
- **Accounting → Reports → Trial Balance**
- Select date → all ledger accounts with DR/CR totals
- DR Total must = CR Total (any difference = an error to fix)

### Ledger Account Report
- **Accounting → Reports → Ledger**
- Select Account (e.g., "Cash in Hand", "HDFC Bank") and date range
- Shows all transactions for that account — opening balance, entries, closing balance

### Day Book
- **Accounting → Reports → Day Book**
- All journal entries for a specific date
- Useful for verifying today's postings before end of day

### Outstanding Reports
- **Receivables:** Sales → Reports → Outstanding Receivables
- **Payables:** Purchase → Reports → Outstanding Payables
- Both support aging analysis (0–30, 31–60, 61–90, 90+ days)

---

## Quick Reference

| Task | Navigation | Frequency |
|------|-----------|-----------|
| Record customer payment | Sales → Payments → Receive | Daily |
| Record supplier payment | Purchase → Payments → Make | As needed |
| Bank reconciliation | Accounting → Bank Recon | Monthly |
| Export GSTR-1 | GST → GSTR-1 | Monthly (by 11th) |
| Export GSTR-3B | GST → GSTR-3B | Monthly (by 20th) |
| Check trial balance | Accounting → Reports → Trial Balance | Weekly |
| Year-end close | Accounting → Year End | Annual (March) |

---

*For help: press **?** on any screen | Call support: 1800-XXX-XXXX*
