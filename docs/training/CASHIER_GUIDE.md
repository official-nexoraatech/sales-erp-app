# ERP Training Guide — CASHIER
## Version 1.0 | Cloth Retail ERP

> **Time to complete:** ~70 minutes across 5 modules  
> **Your most-used screens:** POS Terminal, New Invoice, Sale Returns, Payments

---

## Module 1: POS Operation — Barcode Scan, Bill, Payment (20 min)

### Opening the POS Terminal
1. Go to **http://[your-erp]/pos** (bookmark this page)
2. Login with your cashier credentials
3. Select your **Cash Register / Counter**
4. The POS screen opens — you are ready to bill

### Billing a Customer

**Step 1 — Add items**
- Scan the barcode with the barcode scanner (plug into USB) — a beep and a green flash
  confirm the item was added; a red flash and error message mean the barcode wasn't found
- On a tablet with no scanner attached, tap the 📷 button to scan with the camera instead
- OR type the item name in the search box and press Enter to match the on-screen quick-item grid
- Fast-moving items also show as tiles in the grid below — tap to add

**Step 2 — Adjust quantity**
- Use the **−** / **+** buttons, or type directly into the quantity box
- For fabric: enter metres directly (e.g., 2.5 for 2.5 metres) — fractional quantities are supported

**Step 3 — Apply discount (if allowed)**
- Type a discount % directly into the small box next to any line item
- Or use **Order discount** (above the total) to apply the same % to every line at once
- Discounts above the store's limit will be rejected — ask a manager to log in and complete the sale

**Step 4 — Select customer (optional)**
- For regular customers: type their name/phone in the customer search box
- New customer: tap **+ New**, enter name and phone
- For walk-in customers: leave blank (bills as "Walk-in Customer")
- If the customer has loyalty points, a redeem box appears in the payment step

**Step 5 — Process payment**
- Tap **Charge** (or press **F8**)
- Select payment mode — **Cash** (enter amount received, system shows change), **Card**, or **UPI**
  (shows a QR code for the customer to scan)
- To split the bill across modes, check **Split payment across modes** and enter an amount per mode
- Tap **Complete Sale**

**Step 6 — Print / WhatsApp / Email receipt**
- The receipt screen opens automatically after the sale — pick **58mm** / **80mm** / **A4** paper size
  and tap **Print Receipt** (this opens your browser's print dialog for whichever printer is installed)
- Tap **WhatsApp** or **Email** to send a digital receipt instead (customer must be selected on the sale)

### Holding a sale
- Tap **Held Sales** (top bar) any time to see parked sales, or start a sale and leave it — nothing is
  auto-saved, so use **Hold** (next to Charge) if you need to step away mid-sale
- **Resume** restores the cart exactly as it was; **Discard** removes it

### Working Offline

The POS keeps working with no internet — you can still scan/search items (from the last synced
catalog), look up existing customers, create new customers, and complete sales. Nothing is lost;
everything queues locally and syncs automatically once the connection returns.

**The connectivity dot** (top bar, next to "Last sync"):
- 🟢 **Online** — connected, nothing waiting to sync
- 🟡 **N pending sync** — connected, but N sale(s)/customer(s) are still being sent
- 🔴 **Offline** — no connection right now; everything you do is being queued locally

**Last sync** next to the dot shows when the app last successfully synced — "just now", "5m ago",
"3h ago", etc. If it's been many hours and you're online, tap **Sync now** if it appears, or check
your connection.

**"⚠ N item(s) need attention — Retry"** — one or more queued sales/customers failed to sync
repeatedly (usually a persistent connection problem). Tap **Retry** to reset and try again. If it
keeps happening, tell your manager — there may be a server-side issue.

**"⚠ N stock conflict(s) — Resolve"** — a queued sale can't sync because the stock for an item
changed while you were offline (e.g., another counter sold the last units). Tap **Resolve** to open
the conflict screen, which shows what you queued vs. what's actually available for each item:
- **Adjust & retry** — reduces that line to the available quantity and completes the sale with the
  adjusted quantity
- **Cancel sale** — drops the sale entirely; nothing is charged and no invoice is created
Either way, exactly one outcome happens — you won't end up with a duplicate invoice or a lost sale.
A receipt for a sale completed while offline is marked **"Saved offline — will sync when back
online"** until it actually syncs.

### Common POS Issues

| Issue | Solution |
|-------|---------|
| Barcode not scanning | Check USB connection, or use the 📷 camera-scan button. Try typing the item name manually |
| Item not found | Red flash + error toast means the barcode isn't in the system. Tell manager to add it |
| "Insufficient stock" error | Item is out of stock. Check with owner |
| "Credit limit exceeded" | Customer has unpaid bills. Call manager for override |
| "Discount above X% requires a manager" | A manager needs to log in to complete this sale |
| Connectivity dot stuck on 🔴 Offline | Check WiFi/network. Sales/customers you create still queue safely and will sync once reconnected |
| "⚠ N item(s) need attention — Retry" won't clear | Tap Retry once; if it recurs, tell your manager — the server may be rejecting the sync for another reason |
| "⚠ N stock conflict(s) — Resolve" | Open it, adjust quantity to what's available (or cancel that sale), per "Working Offline" above |
| Forced back to the login screen after being offline a long time | Your session expired while offline. Log in again — queued sales are still saved locally and will sync after you log in |

---

## Module 2: Invoice Creation — Manual (20 min)

Use this for billing without POS (e.g., for wholesale orders, B2B customers with GST).

### Creating a New Invoice

1. **Sales → Invoices → New Invoice**
2. Fill the header:
   - **Customer** — type name or phone to search
   - **Invoice Date** — defaults to today (don't change unless needed)
   - **Branch / Warehouse** — select your branch

3. Add line items:
   - Click **+ Add Item**
   - Search item by name/SKU/barcode
   - Enter **Quantity** and **Rate** (rate auto-fills from price list)
   - GST is calculated automatically

4. Check the totals:
   - **Taxable Amount** — before GST
   - **CGST / SGST** (or IGST for interstate) — tax amount
   - **Grand Total** — final amount to collect

5. Save or Confirm:
   - **Save as Draft** — to finish later (does NOT deduct stock)
   - **Confirm Invoice** — finalizes, deducts stock, generates invoice number

6. **Payment at time of invoicing:**
   - If customer pays immediately: toggle **Receive Payment Now**
   - Enter amount and payment mode
   - Click **Confirm Invoice + Receive Payment**

### Important Rules
- You cannot edit a **Confirmed** invoice. If there's an error, create a Sale Return.
- Invoice date cannot be in a closed financial year (system will show an error).
- Draft invoices do not reserve or deduct stock.

---

## Module 3: Sale Returns (10 min)

When a customer returns goods:

1. **Sales → Sale Returns → New Return**
2. Search for the **original invoice** (by invoice number or customer name)
3. Select the items being returned and quantity
4. Click **Confirm Return**
5. System automatically:
   - Restores stock to warehouse
   - Creates a **Credit Note** for the customer's account

### Using the Credit Note
- Credit Note appears on customer's account as a negative balance
- Next time they purchase, the cashier can apply the credit note:
  - In the invoice → click **Apply Credit Note** → select the credit note
  - Invoice amount is reduced by the credit note value

---

## Module 4: Recording Payments (10 min)

For collecting payment against an existing (unpaid) invoice:

1. **Sales → Payments → Receive Payment**
2. Search customer by name or phone
3. System shows all unpaid invoices for that customer
4. Enter **Amount** received
5. Select **Payment Mode** (Cash / UPI / Card / Cheque / NEFT)
6. For **Cheque**: enter cheque number and bank name
7. For **NEFT/RTGS**: enter transaction reference number
8. Select which invoices to mark as paid (oldest first is recommended)
9. Click **Confirm Payment**

### Cheque Received — What Next?
- The system records the cheque but marks it as **Pending Deposit**
- Once you deposit the cheque at the bank: mark it as **Deposited**
- If cheque bounces: record **Cheque Bounce** (the invoice goes back to unpaid)

---

## Module 5: Alteration Orders (10 min)

For customers who bring garments for stitching or alteration:

### Creating an Alteration Order
1. **HR → Alterations → New Order**
2. Select or create customer
3. Fill:
   - **Description:** what needs to be done (e.g., "Blouse stitching — size 38")
   - **Delivery Date:** when the customer expects it
   - **Advance Received:** if customer pays in advance
   - **Total Charges:** quoted price
4. Click **Save** — order is in **Received** status
5. Print the **Token Slip** and give to customer

### Tracking an Alteration Order
| Status | Meaning | Your Action |
|--------|---------|------------|
| Received | Just logged in | Assign to a tailor |
| In Progress | Tailor working | No action needed |
| Ready | Work done | Call customer |
| Delivered | Customer picked up | Mark as Delivered, collect balance |

### Delivering the Order
1. Find the order: **HR → Alterations → Search by token number**
2. Check **Balance Due** (Total − Advance)
3. Collect payment
4. Click **Mark as Delivered**

---

## Quick Reference Card

| Task | Navigation |
|------|-----------|
| Open POS | Go to /pos URL or Sales → POS |
| New invoice | Sales → Invoices → New |
| Receive payment | Sales → Payments → Receive |
| Sale return | Sales → Sale Returns → New |
| New alteration | HR → Alterations → New |
| Find customer | Masters → Customers → search |
| Print last invoice | Sales → Invoices → open invoice → Print |

### Keyboard Shortcuts (POS)
| Key | Action |
|-----|--------|
| F2 | New bill |
| F8 | Process payment |
| F9 | Repeat last item |
| Esc | Cancel / Go back |
| Enter | Confirm / Search |

---

*For help: press **?** on any screen | Call your manager or support: 1800-XXX-XXXX*
