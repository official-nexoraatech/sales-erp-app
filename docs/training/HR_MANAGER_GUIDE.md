# ERP Training Guide — HR MANAGER
## Version 1.0 | Cloth Retail ERP

> **Time to complete:** ~80 minutes across 4 modules  
> **Payroll is irreversible once approved. Always verify attendance before processing.**

---

## Module 1: Employee Management (15 min)

### Adding a New Employee

1. **HR → Employees → Add New Employee**
2. Fill personal details:
   - Name, Date of Birth, Gender
   - Mobile, Email, Emergency Contact
3. Fill employment details:
   - **Employee Code** (auto-generated or custom)
   - **Department** (Sales, Accounts, Store, Alterations, etc.)
   - **Designation** (Cashier, Accountant, Tailor, etc.)
   - **Date of Joining**
   - **Branch** they are assigned to
4. Fill salary structure:
   - **Basic Salary** (₹ per month)
   - **HRA** (House Rent Allowance — usually 40–50% of basic)
   - **Conveyance Allowance** (₹ per month — up to ₹1,600 is tax-free)
   - **Special Allowance** (any other component)
   - **PF Applicable?** (Yes/No — mandatory if Basic > ₹15,000)
   - **ESIC Applicable?** (Yes/No — if Gross Salary ≤ ₹21,000)
5. Upload documents:
   - Aadhaar card (mandatory)
   - PAN card
   - Bank account details (for salary credit)
6. Click **Save Employee**

### Editing Salary Structure
When an employee gets an increment:
1. **HR → Employees → [Employee Name] → Salary Revision**
2. Enter new salary components
3. Set **Effective Date** (cannot be backdated to a processed payroll month)
4. Click **Save Revision**
5. The revision applies from the specified month

### Employee Exit (Full and Final Settlement)
1. **HR → Employees → [Employee Name] → Initiate Exit**
2. Enter **Last Working Date**
3. System calculates:
   - Pending salary for last partial month
   - Leave encashment (earned leave balance × daily rate)
   - Any pending advances or deductions
4. Generate **Full and Final Settlement** document
5. After payment, click **Mark as Settled** — employee becomes inactive

---

## Module 2: Attendance Management (20 min)

### Daily Attendance Options

**Option A — Manual Entry (for small teams)**
1. **HR → Attendance → Daily Attendance**
2. Select **Date** and **Branch**
3. All employees for that branch appear
4. Mark each as: Present (P) / Absent (A) / Half Day (HD) / Holiday (H)
5. Click **Save**

**Option B — Bulk Import (for larger teams)**
1. Download the attendance template: **HR → Attendance → Download Template**
2. Fill in: Employee Code, Date, Status (P/A/HD)
3. **HR → Attendance → Import → Upload** the filled file
4. Review errors (wrong employee code, missing dates) → fix and re-upload

**Option C — Biometric Integration (if device is connected)**
1. Biometric swipes are automatically synced daily
2. **HR → Attendance → Sync Biometric** (if manual sync needed)
3. Review exceptions: late arrivals, early exits, missing punches

### Monthly Attendance Review
Before running payroll, always review attendance:
1. **HR → Attendance → Monthly Summary**
2. Select Month and Year
3. Check for:
   - **Missing days:** Employees with no record for working days
   - **Excess leaves:** More leaves than leave balance (will be LOP — Loss of Pay)
   - **Holidays:** Confirm public holidays are marked correctly

### Marking Holidays
1. **HR → Settings → Holiday Calendar**
2. Add national and regional holidays for the year
3. These days are automatically excluded from attendance calculation

---

## Module 3: Leave Management (15 min)

### Leave Types (pre-configured)
| Type | Days/Year | Notes |
|------|-----------|-------|
| Casual Leave (CL) | 12 | Cannot be carried forward |
| Sick Leave (SL) | 12 | Medical certificate needed for 3+ consecutive days |
| Earned Leave (EL) | 15 | Carries forward (max 45 days) |
| Maternity Leave | 26 weeks | For female employees |

### Approving Leave Requests
1. **HR → Leave → Pending Requests**
2. Review each request:
   - Who is applying, which dates, which type
   - Current balance of that leave type
3. Click **Approve** or **Reject** (with reason)
4. Approved leaves auto-update attendance for those dates

### Adjusting Leave Balance
If an employee needs additional leaves (one-time):
1. **HR → Leave → Leave Adjustment**
2. Select Employee, Leave Type
3. Enter number of days to Add or Deduct
4. Add a note (reason for adjustment)
5. Click **Save**

### Leave Encashment
For earned leave (on exit or year-end if policy allows):
1. **HR → Leave → Leave Encashment**
2. Select Employee
3. Enter number of days to encash
4. System calculates: (Basic Salary / 26) × No. of Days
5. Amount is added to next payroll

---

## Module 4: Payroll Processing (30 min)

**Process payroll once a month, after attendance is finalised and approved.**

### Step 1 — Verify Attendance is Complete
1. **HR → Attendance → Monthly Summary** → confirm all employees have complete records
2. No missing days, no pending leave requests

### Step 2 — Calculate Payroll
1. **HR → Payroll → New Payroll Run**
2. Select **Month** (e.g., June 2026)
3. Click **Calculate**
4. System computes for each employee:
   - **Gross Salary** = all allowances for the month
   - **LOP Deductions** = (Gross / 26) × absent days
   - **PF Deduction** = 12% of Basic (employee share)
   - **ESIC Deduction** = 0.75% of Gross (if applicable)
   - **Advance Recovery** = any advances given this month
   - **Net Salary** = Gross − all deductions

### Step 3 — Review Calculation
1. The payroll sheet appears with all employees
2. Review employees with unusual deductions or zero salary
3. Click on any employee to see their detailed calculation
4. If you find an error:
   - Do NOT approve yet
   - Go fix the attendance/leave/salary data
   - Click **Recalculate**

### Step 4 — Approve (Owner Required)
1. Click **Submit for Approval**
2. Owner receives an approval notification
3. Owner reviews and clicks **Approve Payroll**
4. **Once approved, payroll cannot be changed for that month**

### Step 5 — Generate Salary Slips
1. **HR → Payroll → [Month] → Generate Salary Slips**
2. All salary slips are generated as PDF
3. Options:
   - **Email all** — sends each employee their slip by email
   - **WhatsApp all** — sends via WhatsApp (if enabled)
   - **Download all** — downloads a ZIP of all PDFs

### Step 6 — Bank Transfer File
1. **HR → Payroll → [Month] → Export Bank File**
2. Downloads a CSV compatible with your bank's bulk salary upload format
3. Upload to your bank's internet banking → Schedule the transfer

### Statutory Payments (after payroll)
| Payment | Due Date | Amount |
|---------|----------|--------|
| PF (Employee + Employer share) | 15th of next month | 24% of Basic (12% each) |
| ESIC | 15th of next month | 4.75% Employer + 0.75% Employee |
| PT (Professional Tax) | State-specific | Varies by state/slab |

---

## Quick Reference

| Task | Navigation | When |
|------|-----------|------|
| Add new employee | HR → Employees → Add | When joining |
| Daily attendance | HR → Attendance → Daily | Every working day |
| Approve leave | HR → Leave → Pending | As requests come |
| Process payroll | HR → Payroll → New Run | Last 2 days of month |
| Generate salary slips | HR → Payroll → Month → Slips | After payroll approval |
| New alteration order | HR → Alterations → New | When customer brings garment |

---

*For help: press **?** on any screen | Call support: 1800-XXX-XXXX*
