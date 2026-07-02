# ERP Training Guide — PURCHASE MANAGER
## Version 1.0 | Cloth Retail ERP

> **Time to complete:** ~65 minutes across 4 modules  
> **Key rule:** Always create a PO before receiving goods. Never receive goods without a GRN.

---

## Module 1: Purchase Order Creation (15 min)

### Why Create a PO?
A Purchase Order is a formal document sent to the supplier confirming what you want to buy, at what price, and by when. Creating a PO in the ERP:
- Creates a record of your order
- Enables price variance check when goods arrive
- Required for 3-way matching (PO → GRN → Invoice)

### Creating a Purchase Order

1. **Purchase → Purchase Orders → New PO**

2. Fill the header:
   - **Supplier** — search by name
   - **Expected Delivery Date** — when you need the goods
   - **Warehouse** — where goods will be received
   - **Terms** — payment terms (e.g., Net 30 days)

3. Add items:
   - Click **+ Add Item**
   - Search item by name/SKU
   - Enter **Quantity** (in metres for fabric, pieces for readymade)
   - Enter **Rate** — price you negotiated with supplier
   - System calculates GST amount automatically based on item's HSN code

4. Save and Submit:
   - **Save as Draft** — to review before sending
   - **Submit PO** — locks the PO and makes it available for approval
   - If amount exceeds your approval limit, PO goes to owner for approval

5. After approval, click **Download PO** (PDF) and email or WhatsApp it to the supplier

### PO Statuses
| Status | Meaning |
|--------|---------|
| Draft | Saved but not submitted |
| Pending Approval | Submitted, waiting for owner to approve |
| Approved | Ready — can now receive against this PO |
| Partially Received | Some goods received, more expected |
| Fully Received | All quantities received |
| Cancelled | Cancelled before receiving any goods |

---

## Module 2: GRN Entry — Goods Receipt Note (20 min)

A GRN records goods physically received from the supplier. Stock increases only after a GRN is confirmed.

### Creating a GRN

1. **Purchase → GRN → New GRN**
2. Search and select the **Purchase Order** (goods must have an approved PO)
3. System auto-fills items and quantities from the PO
4. **Verify physical receipt:**
   - Change **Received Quantity** to what actually arrived (can differ from ordered)
   - Change **Received Rate** if supplier invoiced a different price than PO
5. Enter **Supplier Invoice Number** (from the bill/challan they sent)
6. Check: **Quality OK?** (toggle) — if quality issues, note them
7. Click **Confirm GRN**

### Price Variance Warning
If the received rate differs from PO rate by more than **5%**, the system:
- Shows a warning: "Price variance X%"
- The GRN goes to **Pending Approval** status
- Owner must approve before stock is added

**Why this matters:** A 5% difference on ₹5 lakh of fabric = ₹25,000 extra cost. Always negotiate or get a revised PO.

### Short / Excess Receipt
- **Short receipt:** Received less than ordered → PO remains "Partially Received" for the balance
- **Excess receipt:** Received more than ordered → system asks for approval
- You can receive the balance later (create another GRN against the same PO)

### After GRN Confirmation
- Stock is added to the warehouse automatically
- Supplier payable is created (appears in Payables report)
- GST ITC is available for this period's GSTR-3B

---

## Module 3: Supplier Payments (15 min)

### Viewing Outstanding Payables
1. **Purchase → Reports → Outstanding Payables**
2. Shows all GRNs/invoices not yet paid to each supplier
3. Filter by: Supplier, Due Date, Amount range

### Making a Supplier Payment

1. **Purchase → Payments → Make Payment**
2. Select **Supplier**
3. Outstanding invoices appear — tick which ones you are paying
4. Enter **Amount** (can be partial — will allocate to oldest invoices first)
5. Select **Payment Mode:**
   - NEFT/RTGS → enter UTR number (you'll get this from your bank after transfer)
   - Cheque → enter cheque number, bank name, date
   - Cash → only for small amounts
6. Click **Confirm Payment**
7. Download **Payment Advice** (PDF to email to supplier)

### Advance Payment to Supplier
When you need to pay before goods arrive (e.g., festival season advance):
1. **Purchase → Payments → Make Payment → Toggle "Advance"**
2. Enter amount
3. When GRN arrives: **GRN form → Apply Advance** — the advance is adjusted

### TDS on Payments (if applicable)
- For suppliers where TDS applies (above ₹30,000 per year), toggle **Deduct TDS**
- System calculates TDS at applicable rate
- Supplier receives: Total − TDS
- TDS payable tracked separately in Accounting

---

## Module 4: Purchase Reports (15 min)

### Purchase Summary
- **Purchase → Reports → Purchase Summary**
- Total purchases by: Supplier, Category, Period
- Compare months to track purchasing trends

### Purchase vs Sales (Margin Analysis)
- **Reports → Profitability → Item-wise**
- Shows: Purchase cost vs Sale price → Gross Margin % per item
- Use to identify low-margin items for renegotiation

### Pending POs Report
- **Purchase → Reports → Pending POs**
- Shows POs where goods are not yet received
- Useful for following up with suppliers on delivery

### GRN Register
- **Purchase → Reports → GRN Register**
- All goods received in a period with value
- Required for GST ITC calculation verification

### Supplier Performance Report
- **Purchase → Reports → Supplier Performance**
- On-time delivery %, price variance %, return rate
- Use during supplier negotiations

---

## Quick Reference

| Task | Navigation |
|------|-----------|
| New Purchase Order | Purchase → POs → New |
| Receive goods (GRN) | Purchase → GRN → New |
| Pay a supplier | Purchase → Payments → Make |
| Check what's pending | Purchase → Reports → Pending POs |
| Check supplier outstanding | Purchase → Reports → Outstanding Payables |
| View purchase history | Purchase → Reports → GRN Register |

---

*For help: press **?** on any screen | Call support: 1800-XXX-XXXX*
