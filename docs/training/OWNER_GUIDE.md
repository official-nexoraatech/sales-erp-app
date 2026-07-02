# ERP Training Guide — OWNER / ADMIN
## Version 1.0 | Cloth Retail ERP

> **Time to complete:** ~80 minutes across 5 modules  
> **Login:** Your email + password | Tenant ID provided by implementation team

---

## Module 1: Dashboard and KPIs (15 min)

### What you'll learn
How to read your business health at a glance the moment you log in.

### Your Dashboard
When you log in, the Dashboard shows **today's snapshot**:

| Card | What it means |
|------|--------------|
| **Today's Sales** | Total invoice value confirmed today |
| **Today's Collections** | Cash/bank received today |
| **Pending Receivables** | Total amount customers owe you |
| **Pending Payables** | Total amount you owe suppliers |
| **Stock Value** | Current inventory at cost |
| **Low Stock Alerts** | Items below minimum quantity |

### Reading the Sales Chart
- The bar chart shows daily sales for the last 30 days.
- Click any bar to see that day's invoice list.
- The trend line shows your 7-day moving average.

### Top Customers This Month
The table shows your top 10 customers by sales value. Click any name to open their full account.

### Alerts Panel (right side)
Pay attention to:
- 🔴 **Credit limit exceeded** — customers blocked from new orders
- 🟡 **Cheques due for deposit** — action required today
- 🟡 **Overdue invoices** — follow up with customers
- 🔵 **Pending approvals** — items waiting for your approval

---

## Module 2: Sales Overview and Reports (20 min)

### Quick Sales Check (Daily)
1. Go to **Reports → Sales → Daily Summary**
2. Today's date is pre-selected
3. See: Invoice count, Total value, Cash received, Outstanding

### Sales by Customer
1. **Reports → Sales → By Customer**
2. Select date range (e.g., This Month)
3. Download Excel to share with team

### Outstanding Receivables (Weekly Check)
1. **Reports → Receivables → Aging**
2. Shows buckets: 0–30 days, 31–60 days, 61–90 days, 90+ days
3. Sort by "90+ days" to prioritize follow-ups
4. Click any customer to see their invoice list

### Setting Credit Limits
1. **Masters → Customers → [Customer Name]**
2. Click **Edit**
3. Set **Credit Limit** (₹ amount)
4. The system will automatically block new invoices if the limit is exceeded

### Approving High-Value Invoices
If a sale is above the configured threshold, it needs your approval:
1. **Approvals → Pending** (bell icon, top right)
2. Review the invoice details
3. Click **Approve** or **Reject** with a reason

---

## Module 3: Financial Reports — P&L and Balance Sheet (20 min)

### Profit & Loss Statement
1. **Accounting → Reports → Profit & Loss**
2. Select **Financial Year** or custom date range
3. Key lines to review:
   - **Gross Sales** — total before returns
   - **Net Sales** — after sale returns
   - **Cost of Goods Sold** — your purchase cost
   - **Gross Profit** — Net Sales minus COGS
   - **Operating Expenses** — rent, salary, etc.
   - **Net Profit** — what you actually earned

### Balance Sheet
1. **Accounting → Reports → Balance Sheet**
2. Shows your financial position as of a date
3. **Assets side:** Cash, Receivables, Stock, Fixed Assets
4. **Liabilities side:** Payables, Loans, Owner's Capital

### Understanding Your Cash Flow
1. **Accounting → Reports → Cash Flow**
2. Shows money coming in vs going out each month
3. Negative months mean you spent more than you received

### Common Questions
- **"Why does profit look high but I have no cash?"**  
  Your profit includes unpaid invoices. Check the Receivables report.
- **"My stock value seems wrong"**  
  Go to Reports → Inventory → Stock Valuation and compare with physical count.

---

## Module 4: Staff Management — Users and Roles (10 min)

### Adding a New User
1. **Settings → Users → Add New User**
2. Fill: Name, Email, Mobile
3. Select **Role** (see roles below)
4. Select **Branch** they work at
5. Set a temporary password — user will be prompted to change on first login

### Roles Available

| Role | What they can do |
|------|-----------------|
| **OWNER** | Everything — all modules, reports, settings |
| **SALES_MANAGER** | Sales + approvals for discounts/credit limit overrides |
| **CASHIER** | Create invoices, POS, record payments, alteration orders |
| **ACCOUNTANT** | Payments, bank reconciliation, GST returns, financial reports |
| **PURCHASE_MANAGER** | Purchase orders, GRN, supplier payments |
| **HR_MANAGER** | Employee management, attendance, leave, payroll |
| **STAFF** | View only — cannot create or approve anything |

### Deactivating a Staff Member
1. **Settings → Users → [User Name]**
2. Toggle **Active** to OFF
3. Their login is immediately blocked (no need to change password)

### Resetting a Password
1. **Settings → Users → [User Name] → Reset Password**
2. A temporary password is sent to their registered email

---

## Module 5: Configuration — GST Settings and Number Series (15 min)

### GST Configuration (One-Time Setup)
1. **Settings → Organization → GST Settings**
2. Enter:
   - **GSTIN** (15-character GST number)
   - **State** (for CGST/SGST vs IGST calculation)
   - **HSN/SAC mandatory above:** ₹50,000 (as per GST rules)
   - **e-Invoice threshold:** ₹5 crore (enable when applicable)

### Number Series
Each document type has its own auto-numbering:
1. **Settings → Number Series**
2. You can customise:
   - **Prefix:** e.g., `INV-2026-`
   - **Starting number:** e.g., `0001`
   - **Financial year reset:** Toggle ON to restart at 0001 each April

Example: `INV-2026-0001`, `INV-2026-0002`, ...

### Financial Year
1. **Settings → Financial Year**
2. Current FY is shown (e.g., April 2026 – March 2027)
3. Do not close the FY until you are ready — this is irreversible

### Branch Configuration
1. **Settings → Branches → [Branch Name]**
2. Set: Address, GSTIN (if different from HO), Warehouse assignment

---

## Quick Reference — Common Tasks

| Task | Where |
|------|-------|
| Check today's sales | Dashboard → Today's Sales card |
| See overdue customers | Reports → Receivables → Aging → sort 90+ days |
| Approve a pending invoice | Approvals (bell icon, top right) |
| Add a new staff member | Settings → Users → Add |
| Download P&L for the month | Accounting → Reports → P&L → Export |
| Change GST settings | Settings → Organization → GST |

---

*For help: press **?** on any screen | Call support: 1800-XXX-XXXX*
