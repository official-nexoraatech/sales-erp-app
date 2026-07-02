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
- Scan the barcode with the barcode scanner (plug into USB)
- OR type the item name/code in the search box and press Enter
- Each scan adds the item to the bill

**Step 2 — Adjust quantity**
- Click on the quantity number next to an item and type the new value
- For fabric: enter metres (e.g., 2.5 for 2.5 metres)

**Step 3 — Apply discount (if allowed)**
- Click **Discount** on any line item
- Type the discount amount (₹) or percentage (%)
- Discounts above your allowed limit require manager approval

**Step 4 — Select customer (optional)**
- For regular customers: type their name/phone in the customer search box
- For walk-in customers: leave blank (bills as "Walk-in Customer")

**Step 5 — Process payment**
- Click **Pay** (green button, bottom right)
- Select payment mode:
  - **Cash** — enter amount received, system shows change to return
  - **UPI** — show QR code to customer, confirm payment received
  - **Card** — swipe/tap and enter last 4 digits for reference
  - **Split** — enter amounts for each mode (total must equal bill amount)
- Click **Confirm Payment**

**Step 6 — Print / WhatsApp receipt**
- Receipt prints automatically if printer is connected
- Click **WhatsApp** to send digital receipt to customer's phone

### Common POS Issues

| Issue | Solution |
|-------|---------|
| Barcode not scanning | Check USB connection. Try typing the code manually |
| Item not found | The item may not be in the system. Tell manager to add it |
| "Insufficient stock" error | Item is out of stock. Check with owner |
| "Credit limit exceeded" | Customer has unpaid bills. Call manager for override |

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
