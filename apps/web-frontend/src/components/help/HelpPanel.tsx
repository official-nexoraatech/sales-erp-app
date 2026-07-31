import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ExternalLink,
  BookOpen,
  ChevronRight,
  Keyboard,
  Search,
  Mail,
  Flag,
  Activity,
  Sparkles,
} from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { ShortcutsModal } from './ShortcutsModal.js';
import { WhatsNewModal } from './WhatsNewModal.js';
import { TourLaunchButton } from './TourLaunchButton.js';
import { useTour, getAllTours, matchesRoutePattern } from '../../dap/index.js';
import { useTourProgress, findProgress } from '../../dap/api/useTourProgress.js';

// apps/docs-site is a separate Vite app (own port in dev, own deploy target once one
// exists) with real per-module documentation — search, FAQ, and Client/Admin/Developer/
// Audit tracks. It predates this fix but was never linked from anywhere in the product.
const DOCS_SITE_URL = import.meta.env.VITE_DOCS_SITE_URL ?? 'http://localhost:5175';

interface HelpTask {
  label: string;
  description: string;
  link?: { href: string; text: string };
}

interface HelpContent {
  title: string;
  description: string;
  tasks: HelpTask[];
  guideUrl?: string;
}

// ── Per-route help content ────────────────────────────────────────────────────

const HELP_CONTENT: Record<string, HelpContent> = {
  '/dashboard': {
    title: 'Dashboard',
    description: "Your business at a glance — today's sales, collections, alerts, and KPIs.",
    tasks: [
      {
        label: "Read today's sales",
        description: 'The "Today\'s Sales" card shows all confirmed invoices billed today.',
      },
      {
        label: 'See overdue customers',
        description: 'Check the Outstanding Receivables widget. Click to see aging detail.',
      },
      {
        label: 'Approve pending items',
        description:
          'The Approvals badge (bell icon, top right) shows items waiting for your action.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/reports/index.html#reports/client/overview`,
  },
  '/sales/invoices': {
    title: 'Invoices',
    description: 'Create and manage customer invoices with automatic GST calculation.',
    tasks: [
      {
        label: 'Create a new invoice',
        description: 'Click "New Invoice" → select customer → add items → Confirm.',
      },
      {
        label: 'Record payment for an invoice',
        description: 'Open the invoice → click "Record Payment" → enter amount and mode.',
      },
      {
        label: 'Cancel an invoice',
        description:
          'Open invoice → Actions → Cancel. Only DRAFT invoices can be deleted; CONFIRMED invoices require a Sale Return.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/sales/index.html#sales/client/invoices`,
  },
  '/sales/pos': {
    title: 'POS Terminal',
    description: 'Fast billing at the counter — barcode scan, split payment, instant receipt.',
    tasks: [
      {
        label: 'Scan a barcode',
        description:
          'Click the search box and scan with barcode scanner — item adds to bill automatically.',
      },
      {
        label: 'Process split payment',
        description:
          'In payment modal, click "Split" — enter amounts for Cash, UPI, and Card separately.',
      },
      {
        label: 'Send WhatsApp receipt',
        description:
          'After payment, click "WhatsApp" — customer receives digital receipt instantly.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/pos/index.html#pos/client/billing`,
  },
  '/sales/returns': {
    title: 'Sale Returns',
    description:
      'Process customer returns — stock is restored and a credit note is created automatically.',
    tasks: [
      {
        label: 'Create a return',
        description:
          'Click "New Return" → search the original invoice → select returned items → Confirm.',
      },
      {
        label: 'Apply credit note',
        description:
          "The credit note appears on the customer account. Apply it on the customer's next invoice.",
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/sales/index.html#sales/client/returns`,
  },
  '/purchase/orders': {
    title: 'Purchase Orders',
    description: 'Create POs for suppliers — required before receiving goods.',
    tasks: [
      {
        label: 'Create a purchase order',
        description: 'New PO → select supplier → add items with quantity and rate → Submit.',
      },
      {
        label: 'Send PO to supplier',
        description: 'Open approved PO → Download PDF → Email or WhatsApp to supplier.',
      },
      {
        label: 'Receive goods against PO',
        description: 'Go to Purchase → GRN → New → search this PO → enter received quantities.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/purchase/index.html#purchase/client/purchase-orders`,
  },
  '/purchase/grns': {
    title: 'Goods Receipt Notes (GRN)',
    description:
      'Record goods received from suppliers — stock increases only after GRN is confirmed.',
    tasks: [
      {
        label: 'Create a GRN',
        description: 'New GRN → select the Purchase Order → verify quantities received → Confirm.',
      },
      {
        label: 'Handle price variance',
        description: 'If received rate differs from PO rate by >5%, GRN needs owner approval.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/purchase/index.html#purchase/client/grn`,
  },
  '/accounting/bank-reconciliation': {
    title: 'Bank Reconciliation',
    description: 'Match your bank statement with ERP entries to ensure books are accurate.',
    tasks: [
      {
        label: 'Import bank statement',
        description:
          'Click "Import Statement" → upload CSV/Excel from your bank\'s internet banking.',
      },
      {
        label: 'Auto-match entries',
        description: 'Click "Auto-Match" — system matches by amount, date, and reference number.',
      },
      {
        label: 'Finalize reconciliation',
        description: 'After all entries are matched, click "Finalize" to lock the period.',
      },
    ],
    // No dedicated bank-reconciliation page exists in docs-site — the closest real match is
    // the period-closing checklist, which explicitly lists "bank reconciliation complete" as
    // a precondition. Better than the generic Overview page this pointed to before, but still
    // an approximation, not a dedicated guide.
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/closing`,
  },
  '/gst/gstr1': {
    title: 'GSTR-1 (Sales Return)',
    description: 'Monthly GST return for all outward supplies — due 11th of next month.',
    tasks: [
      {
        label: 'Verify period invoices',
        description: 'Check the B2B and B2C summary matches your Sales report for the same period.',
      },
      {
        label: 'Export GSTR-1',
        description: 'Click "Export" → download JSON → upload on gst.gov.in portal.',
      },
      {
        label: 'Check GSTIN is filled',
        description: 'B2B invoices without GSTIN go to B2C — update customer masters if needed.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },
  '/gst/gstr3b': {
    title: 'GSTR-3B (Summary Return)',
    description:
      'Monthly summary return — shows net tax payable after ITC. Due 20th of next month.',
    tasks: [
      {
        label: 'Review tax liability',
        description: 'Section 3.1 shows your outward tax. Section 4A shows ITC from purchases.',
      },
      {
        label: 'Calculate net tax',
        description: 'Net tax = 3.1 total − 4A total. This amount must be paid on GST portal.',
      },
      {
        label: 'Export and file',
        description: 'Download Excel → cross-check → file on GST portal → pay net tax.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },
  '/hr/payroll': {
    title: 'Payroll',
    description:
      'Process monthly salary — calculate, approve, generate slips, and bank transfer file.',
    tasks: [
      {
        label: 'Start payroll run',
        description:
          "New Payroll Run → select month → Calculate → review each employee's net salary.",
      },
      {
        label: 'Submit for approval',
        description:
          'After review, click "Submit for Approval" — owner receives notification to approve.',
      },
      {
        label: 'Generate salary slips',
        description: 'After approval → Generate Salary Slips → email or WhatsApp to all employees.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/payroll`,
  },
  '/hr/attendance': {
    title: 'Attendance',
    description: 'Record daily attendance — required before running payroll each month.',
    tasks: [
      {
        label: 'Mark daily attendance',
        description: 'Select date and branch → mark each employee P / A / HD → Save.',
      },
      {
        label: 'Import from file',
        description: 'Download template → fill → Upload — for bulk attendance entry.',
      },
      {
        label: 'Review monthly summary',
        description: 'Monthly Summary view shows totals before payroll processing.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/attendance-leave`,
  },
  '/customers': {
    title: 'Customers',
    description: 'Manage your customer master — GSTIN, credit limits, outstanding balances.',
    tasks: [
      {
        label: 'Add a new customer',
        description: 'Click "New Customer" → fill name, mobile, GSTIN (for B2B) → Save.',
      },
      {
        label: 'Set credit limit',
        description:
          'Open customer → Edit → set Credit Limit → system will block invoices above this.',
      },
      {
        label: 'View customer account',
        description: 'Click customer name → 360° view: invoices, payments, outstanding, history.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/customers/index.html#customers/client/customers`,
  },
  '/settings/organization': {
    title: 'Organization Settings',
    description: 'Your company details — GSTIN, address, logo, financial year settings.',
    tasks: [
      {
        label: 'Update GSTIN',
        description: 'Enter your 15-character GSTIN — required for all tax invoices.',
      },
      {
        label: 'Configure GST state',
        description: 'Set your registered state — determines CGST+SGST vs IGST calculation.',
      },
      {
        label: 'Upload company logo',
        description: 'Logo appears on all PDFs — invoices, POs, salary slips.',
      },
    ],
  },

  // ── Accounting (remainder) ──────────────────────────────────────────────────
  '/accounting/chart-of-accounts': {
    title: 'Chart of Accounts',
    description: 'The ledger accounts every journal entry, invoice, and payment posts against.',
    tasks: [
      {
        label: 'Add a new account',
        description: 'New Account → select type (Asset/Liability/Income/Expense) → Save.',
      },
      {
        label: 'Seed default accounts',
        description: 'New tenants: click "Seed Default Accounts" to create a standard starter set.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/coa-journals`,
  },
  '/accounting/journals': {
    title: 'Journal Entries',
    description: "Manual double-entry postings for adjustments invoices and payments don't cover.",
    tasks: [
      {
        label: 'Create a manual journal',
        description: 'New Journal → add debit/credit lines that balance to zero → Post.',
      },
      {
        label: 'Reverse a posted journal',
        description:
          'Open the journal → Reverse — creates an offsetting entry rather than editing the original.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/coa-journals`,
  },
  '/accounting/financial-years': {
    title: 'Financial Years',
    description: 'Defines the accounting periods your reports and closing procedures run against.',
    tasks: [
      {
        label: 'Create a financial year',
        description:
          'Required before Trial Balance/P&L/Balance Sheet can be generated for that period.',
      },
      {
        label: 'Close a financial year',
        description: 'Locks the period after all checks pass — see the Closing guide.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/closing`,
  },
  '/accounting/opening-balances': {
    title: 'Opening Balances',
    description:
      'Enter your starting bank balance and outstanding customer/supplier amounts when moving to this ERP.',
    tasks: [
      {
        label: 'Enter opening bank balance',
        description: "Set each bank account's balance as of your go-live date.",
      },
      {
        label: 'Enter customer/supplier opening balances',
        description: 'Carries forward outstanding dues from your previous system.',
      },
    ],
  },
  '/accounting/cost-centers': {
    title: 'Cost Centers',
    description:
      'Tag income/expense to a branch, department, or project for more granular reporting.',
    tasks: [
      { label: 'Create a cost center', description: 'New Cost Center → name it → Save.' },
      {
        label: 'Assign a cost center to a journal line',
        description: 'Pick it from the dropdown while entering a journal line.',
      },
    ],
  },
  '/accounting/fixed-assets': {
    title: 'Fixed Assets',
    description: 'Track assets like furniture and equipment, and their depreciation over time.',
    tasks: [
      {
        label: 'Register a fixed asset',
        description: 'New Asset → enter cost, purchase date, and depreciation method.',
      },
      {
        label: 'Run depreciation for a period',
        description: 'Posts a depreciation journal for all active assets.',
      },
    ],
  },
  '/accounting/tds': {
    title: 'TDS (Tax Deducted at Source)',
    description: 'Track and file tax deducted on supplier and professional payments.',
    tasks: [
      {
        label: 'Record TDS on a payment',
        description: 'When recording a supplier payment, enter the TDS section and rate applied.',
      },
      {
        label: 'Generate a TDS certificate',
        description: 'Export the certificate for the deductee once TDS is filed.',
      },
    ],
  },
  '/accounting/reports/trial-balance': {
    title: 'Trial Balance',
    description: "Every account's debit and credit total for a period — must always balance.",
    tasks: [
      {
        label: 'Select the period',
        description: 'Choose a financial year and date range to generate.',
      },
      {
        label: 'Investigate an imbalance',
        description: 'If debits ≠ credits, this indicates a posting error — contact support.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/reports`,
  },
  '/accounting/reports/balance-sheet': {
    title: 'Balance Sheet',
    description: 'Assets, liabilities, and equity as of a specific date.',
    tasks: [
      {
        label: 'Select the as-of date',
        description: 'Usually the last day of a month, quarter, or year.',
      },
      {
        label: 'Compare to a prior period',
        description: 'Use the comparison toggle to see period-over-period change.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/reports`,
  },
  '/accounting/reports/profit-loss': {
    title: 'Profit & Loss',
    description: 'Income and expenses over a period, ending in net profit or loss.',
    tasks: [
      {
        label: 'Select the date range',
        description: 'Common ranges: this month, this quarter, this financial year.',
      },
      {
        label: "Drill into an account's transactions",
        description: 'Click any line item to see the transactions behind it.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/reports`,
  },
  '/accounting/reports/cash-flow': {
    title: 'Cash Flow',
    description:
      'Cash movement over a period, grouped into operating, investing, and financing activity.',
    tasks: [
      {
        label: 'Select the period',
        description: 'Compares cash actually received/paid, not accrued income/expense.',
      },
      {
        label: 'Compare cash flow to net profit',
        description: 'A gap usually means unpaid invoices or bills, not an error.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/reports`,
  },

  // ── GST ──────────────────────────────────────────────────────────────────────
  '/gst/register': {
    title: 'GST Register',
    description:
      'The ledger of every transaction’s GST classification, used to build your returns.',
    tasks: [
      {
        label: "Review a period's register",
        description: 'Filter by period to see every classified transaction.',
      },
      {
        label: 'Check for unclassified transactions',
        description: 'These need a GST rate/type before returns can be filed accurately.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },
  '/gst/gstr2a': {
    title: 'GSTR-2A (Purchase-side reconciliation)',
    description:
      'Auto-drafted return showing what your suppliers have reported against your GSTIN.',
    tasks: [
      {
        label: 'Compare GSTR-2A to your purchase register',
        description: 'Look for bills your suppliers haven’t yet reported.',
      },
      {
        label: 'Follow up on mismatches',
        description: 'Contact the supplier if an amount or GSTIN doesn’t match.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },
  '/gst/gstr9': {
    title: 'GSTR-9 (Annual Return)',
    description: 'Yearly consolidation of all monthly/quarterly GST returns filed.',
    tasks: [
      {
        label: 'Review the annual summary',
        description: 'Covers the full financial year in one consolidated view.',
      },
      {
        label: 'Reconcile against monthly totals',
        description: 'Cross-check against your filed GSTR-1/GSTR-3B for the same year.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },
  '/gst/einvoice': {
    title: 'e-Invoicing',
    description:
      'Generates the IRN (Invoice Reference Number) required for B2B invoices above the e-invoicing threshold.',
    tasks: [
      {
        label: 'Generate an e-invoice IRN',
        description: 'Open a confirmed B2B invoice → Generate IRN.',
      },
      {
        label: 'Cancel an e-invoice',
        description: 'Must be done within 24 hours of generation, per GST rules.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/einvoice`,
  },
  '/gst/compliance': {
    title: 'GST Compliance Dashboard',
    description: 'A single view of upcoming filing deadlines and pending compliance tasks.',
    tasks: [
      {
        label: 'Check upcoming due dates',
        description: 'GSTR-1 (11th), GSTR-3B (20th) of the following month, by default.',
      },
      {
        label: 'See which returns are pending',
        description: 'Flags any period not yet marked filed.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },
  '/gst/config': {
    title: 'GST Configuration',
    description:
      'Your GSTIN, registered state, and default tax rates used across sales and purchase.',
    tasks: [
      {
        label: 'Set your registered state',
        description: 'Determines CGST+SGST (intrastate) vs IGST (interstate) on invoices.',
      },
      {
        label: 'Update default tax rates',
        description: 'Sets the fallback rate for items without their own rate configured.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/gst-returns`,
  },

  // ── HR (remainder) ──────────────────────────────────────────────────────────
  '/hr/employees': {
    title: 'Employees',
    description:
      'The employee master — designation, department, salary structure, and bank details.',
    tasks: [
      {
        label: 'Add a new employee',
        description: 'New Employee → personal details, salary structure, bank account.',
      },
      {
        label: 'Update salary structure',
        description: 'Changes apply from the next payroll run onward, not retroactively.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/employees`,
  },
  '/hr/leaves': {
    title: 'Leave Applications',
    description: 'Employees apply for leave; managers approve or reject.',
    tasks: [
      { label: 'Apply for leave', description: 'Select dates and leave type → Submit.' },
      {
        label: 'Approve or reject a request',
        description: 'Pending requests show under your Approvals.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/attendance-leave`,
  },
  '/hr/holidays': {
    title: 'Holiday Calendar',
    description: 'The list of paid holidays used by attendance and payroll calculations.',
    tasks: [
      { label: 'Add a holiday', description: 'New Holiday → date and name → Save.' },
      {
        label: "Review the year's holiday list",
        description: 'Check before finalizing a month’s attendance.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/attendance-leave`,
  },
  '/hr/alterations': {
    title: 'Alteration Orders',
    description:
      'Counter screen for tailoring alteration jobs — capture the customer, items, and assign a tailor.',
    tasks: [
      {
        label: 'Create an alteration order',
        description: 'Enter the customer, items needing alteration, and charges.',
      },
      {
        label: 'Assign a tailor and track status',
        description: 'Assign from your team, then update status as work progresses.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/alterations`,
  },
  '/hr/form16': {
    title: 'Form 16',
    description: 'Annual TDS certificate generated for each employee from payroll data.',
    tasks: [
      {
        label: 'Generate Form 16 for an employee',
        description: 'Select the employee and financial year → Generate.',
      },
      {
        label: 'Bulk-generate at year end',
        description: 'Generate for all employees in one action.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/statutory`,
  },
  '/hr/pf-challans': {
    title: 'PF Challans',
    description: 'Monthly Provident Fund contribution challans generated from payroll.',
    tasks: [
      {
        label: "Generate this month's PF challan",
        description: 'Requires payroll for the month to be approved first.',
      },
      {
        label: 'Download for EPFO filing',
        description: 'Download the challan in the format required by the EPFO portal.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/statutory`,
  },
  '/hr/esi-challans': {
    title: 'ESI Challans',
    description: 'Monthly Employee State Insurance contribution challans generated from payroll.',
    tasks: [
      {
        label: "Generate this month's ESI challan",
        description: 'Requires payroll for the month to be approved first.',
      },
      {
        label: 'Download for ESIC filing',
        description: 'Download the challan in the format required by the ESIC portal.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/hr/index.html#hr/client/statutory`,
  },

  // ── Inventory (remainder) ───────────────────────────────────────────────────
  '/inventory/items': {
    title: 'Items',
    description: 'Your product catalog — SKU, barcode, HSN code, and prices.',
    tasks: [
      {
        label: 'Add a new item',
        description: 'New Item → SKU, name, HSN code, sale price → Save.',
      },
      {
        label: 'Bulk import items',
        description: 'Download the template, fill it in, then upload for bulk creation.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/products/index.html#products/client/items`,
  },
  '/inventory/stock': {
    title: 'Stock',
    description: 'Real-time on-hand quantity per item, per warehouse.',
    tasks: [
      { label: 'Check stock for an item', description: 'Search by name, SKU, or barcode.' },
      {
        label: 'Filter by warehouse',
        description: 'See stock at one location instead of the tenant-wide total.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/inventory/index.html#inventory/client/stock`,
  },
  '/inventory/adjustments': {
    title: 'Stock Adjustments',
    description:
      'Correct stock discrepancies found during physical counts (Draft → Submit → Approve).',
    tasks: [
      {
        label: 'Create an adjustment',
        description: 'Select the item and warehouse, then enter the corrected quantity.',
      },
      {
        label: 'Submit for approval',
        description: 'An approver must confirm before stock actually changes.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/inventory/index.html#inventory/client/adjustments`,
  },
  '/inventory/transfers': {
    title: 'Stock Transfers',
    description: 'Move stock between warehouses or branches (Draft → Submit → Dispatch → Receive).',
    tasks: [
      {
        label: 'Create a transfer',
        description: 'Select source/destination warehouse and items → Submit.',
      },
      {
        label: 'Receive a dispatched transfer',
        description: 'The destination warehouse confirms receipt to complete the transfer.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/inventory/index.html#inventory/client/transfers`,
  },
  '/inventory/valuation': {
    title: 'Stock Valuation',
    description: 'The total value of on-hand stock, using weighted-average cost.',
    tasks: [
      {
        label: 'Check valuation by warehouse',
        description: 'See how much stock value sits at each location.',
      },
      {
        label: 'Check valuation by category',
        description: 'Useful for identifying slow-moving, high-value categories.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/inventory/index.html#inventory/client/valuation`,
  },
  '/inventory/physical-verifications': {
    title: 'Physical Verification',
    description: 'Count physical stock and compare against system records to find variances.',
    tasks: [
      {
        label: 'Start a verification count',
        description: 'Choose a warehouse and count sheet to begin.',
      },
      {
        label: 'Review and post variances',
        description: 'Confirmed variances flow into a Stock Adjustment automatically.',
      },
    ],
  },
  '/inventory/categories': {
    title: 'Categories',
    description:
      'Group items for reporting and catalog organization (e.g. Sarees, Shirting, Suiting).',
    tasks: [{ label: 'Add a category', description: 'New Category → name it → Save.' }],
    guideUrl: `${DOCS_SITE_URL}/products/index.html#products/client/taxonomy`,
  },
  '/inventory/brands': {
    title: 'Brands',
    description: 'The brand master used on item records.',
    tasks: [{ label: 'Add a brand', description: 'New Brand → name it → Save.' }],
    guideUrl: `${DOCS_SITE_URL}/products/index.html#products/client/taxonomy`,
  },
  '/inventory/units': {
    title: 'Units',
    description: 'Units of measure (meters, pieces, kg) used on items and transactions.',
    tasks: [{ label: 'Add a unit', description: 'New Unit → name and abbreviation → Save.' }],
  },
  '/inventory/price-lists': {
    title: 'Price Lists',
    description:
      "Customer- or channel-specific pricing that overrides an item's standard sale price.",
    tasks: [
      { label: 'Create a price list', description: 'New Price List → set item-level overrides.' },
      {
        label: 'Assign a price list to a customer',
        description: 'Open the customer → set their applicable price list.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/products/index.html#products/client/price-lists`,
  },
  '/inventory/fabric-rolls': {
    title: 'Fabric Rolls',
    description:
      'Roll-level tracking for fabric stock — receive a roll, then cut it into sold lengths.',
    tasks: [
      {
        label: 'Receive a fabric roll',
        description: 'Record the roll number and total length received.',
      },
      {
        label: 'Cut a roll for a sale',
        description: 'Deducts the cut length from the roll’s remaining balance.',
      },
    ],
  },

  // ── Production ───────────────────────────────────────────────────────────────
  '/production/job-work': {
    title: 'Job Work Orders',
    description:
      'Send materials to an outside job worker for processing (e.g. dyeing, printing) and track their return.',
    tasks: [
      {
        label: 'Create a job work order',
        description: 'Select the job worker and materials sent for processing.',
      },
      {
        label: 'Record materials received back',
        description: 'Close out the order once processed goods return.',
      },
    ],
  },
  '/production/job-work/new': {
    title: 'New Job Work Order',
    description: 'Create a job work order to send materials to an outside job worker.',
    tasks: [
      {
        label: 'Select the job worker and materials sent',
        description: 'Enter what’s being sent out and to whom.',
      },
      {
        label: 'Save as draft or submit directly',
        description: 'Draft lets you finish details later before submitting.',
      },
    ],
  },
  '/production/reorder': {
    title: 'Reorder Report',
    description: 'Suggests purchase quantities based on stock levels and reorder points.',
    tasks: [
      {
        label: 'Review reorder suggestions',
        description: 'Items below their reorder point are flagged.',
      },
      {
        label: 'Create POs from the report',
        description: 'Bulk-creates purchase orders for the selected suggestions.',
      },
    ],
  },
  '/production/barcode-labels': {
    title: 'Barcode Labels',
    description: 'Print barcode labels for items, sized for common label printers.',
    tasks: [
      {
        label: 'Select items and print labels',
        description: 'Choose items and quantity of labels, then print.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/products/index.html#products/client/barcodes`,
  },
  '/production/consignment/stock': {
    title: 'Consignment Stock',
    description: 'Track goods received on consignment — not on your balance sheet until sold.',
    tasks: [
      {
        label: 'Receive consignment stock',
        description: 'Record what’s received from the consignor.',
      },
      {
        label: "Check what's still unsold",
        description: 'Unsold consignment stock stays out of your valuation.',
      },
    ],
  },
  '/production/consignment/settlements': {
    title: 'Consignment Settlements',
    description: 'Monthly settlement of consigned goods actually sold to customers.',
    tasks: [
      {
        label: 'Run a monthly settlement',
        description: 'Calculates what’s owed to the consignor for goods sold that month.',
      },
      {
        label: 'Review what’s owed',
        description: 'Check the settlement breakdown before paying the consignor.',
      },
    ],
  },

  // ── Purchase (remainder) ─────────────────────────────────────────────────────
  '/purchase/returns': {
    title: 'Purchase Returns',
    description: 'Return goods to a supplier — stock decreases and a debit note is created.',
    tasks: [
      {
        label: 'Create a purchase return',
        description: 'Select the original GRN → choose returned items → Confirm.',
      },
      {
        label: 'Apply a debit note',
        description: 'The debit note reduces what you owe the supplier.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/purchase/index.html#purchase/client/returns`,
  },
  '/purchase/payments': {
    title: 'Supplier Payments',
    description: 'Record payments made to suppliers against their bills.',
    tasks: [
      {
        label: 'Record a payment',
        description: 'Select the supplier and bill(s), enter amount and mode.',
      },
      {
        label: 'Allocate across multiple bills',
        description: 'One payment can be split across several outstanding bills.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/purchase/index.html#purchase/client/payments`,
  },
  '/purchase/expenses': {
    title: 'Purchase Expenses',
    description: 'Record non-inventory expenses tied to a purchase (freight, loading, etc.).',
    tasks: [
      { label: 'Record an expense', description: 'New Expense → category and amount.' },
      {
        label: 'Attach it to a PO/GRN',
        description: 'Link the expense to the relevant purchase for accurate landed cost.',
      },
    ],
  },

  // ── Sales (remainder) ────────────────────────────────────────────────────────
  '/sales/quotations': {
    title: 'Quotations',
    description:
      'A non-binding price quote for a customer, convertible to an invoice once accepted.',
    tasks: [
      {
        label: 'Create a quotation',
        description: 'New Quotation → select customer → add items → Save.',
      },
      {
        label: 'Convert to an invoice',
        description: 'Once the customer accepts, convert it directly — no re-entry needed.',
      },
    ],
  },
  '/sales/payments': {
    title: 'Customer Payments',
    description: 'Record payments received from customers against their invoices.',
    tasks: [
      {
        label: 'Record a payment',
        description: 'Select the customer and invoice(s), enter amount and mode.',
      },
      {
        label: 'Allocate across multiple invoices',
        description: 'One payment can be split across several outstanding invoices.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/sales/index.html#sales/client/payments`,
  },
  '/sales/delivery-challans': {
    title: 'Delivery Challans',
    description:
      'A delivery document for goods sent without an immediate sale (e.g. on approval, job work).',
    tasks: [
      {
        label: 'Create a delivery challan',
        description: 'Select customer and items being delivered → Confirm.',
      },
      {
        label: 'Convert to an invoice later',
        description: 'If the goods are eventually sold, convert the challan directly.',
      },
    ],
  },

  // ── CRM ──────────────────────────────────────────────────────────────────────
  '/crm/segments': {
    title: 'Customer Segments',
    description:
      'Group customers by criteria (spend, location, purchase history) for targeted marketing.',
    tasks: [
      {
        label: 'Create a segment',
        description: 'Define the criteria that qualify a customer for this segment.',
      },
      {
        label: 'See matching customers',
        description: 'Open the segment to see the current list of matching customers.',
      },
    ],
  },
  '/crm/campaigns': {
    title: 'Campaigns',
    description: 'Send marketing messages (SMS/WhatsApp/Email) to a segment.',
    tasks: [
      {
        label: 'Create a campaign',
        description: 'Select a segment, channel, and message content.',
      },
      {
        label: 'Send a campaign',
        description: 'Review recipients, then send — or schedule for later.',
      },
    ],
  },
  '/crm/campaign-settings': {
    title: 'Campaign Settings',
    description:
      'Configure sender details and channel connections (WhatsApp Business, SMS gateway) used by campaigns.',
    tasks: [
      {
        label: 'Connect a channel',
        description: 'Link your WhatsApp Business or SMS gateway account.',
      },
      {
        label: 'Set default sender details',
        description: 'Applies to every campaign unless overridden.',
      },
    ],
  },
  '/crm/seasons': {
    title: 'Festival Season Planner',
    description:
      'Define business seasons (e.g. Diwali, wedding season) with stock multipliers and loyalty bonuses.',
    tasks: [
      {
        label: 'Create a season',
        description: 'Set the date range and expected demand multiplier.',
      },
      {
        label: 'Set a stock multiplier',
        description: 'Used by reorder suggestions during that season.',
      },
    ],
  },

  // ── Reports ──────────────────────────────────────────────────────────────────
  '/reports': {
    title: 'Reports',
    description: 'Browse and run every report in the system, scheduled or on-demand.',
    tasks: [
      { label: 'Run a report', description: 'Pick a report, set filters, and run it immediately.' },
      { label: 'Export results', description: 'Export to Excel or PDF from the results view.' },
    ],
    guideUrl: `${DOCS_SITE_URL}/reports/index.html#reports/client/overview`,
  },
  '/reports/schedules': {
    title: 'Scheduled Reports',
    description: 'Have a report auto-generated and emailed on a recurring schedule.',
    tasks: [
      {
        label: 'Schedule a report',
        description: 'Pick a report, recipients, and recurrence (daily/weekly/monthly).',
      },
      {
        label: 'Pause or edit a schedule',
        description: 'Existing schedules can be paused or changed at any time.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/reports/index.html#reports/client/scheduling`,
  },

  // ── Security ─────────────────────────────────────────────────────────────────
  '/security': {
    title: 'Security',
    description: 'Review login activity and account-security events for this tenant.',
    tasks: [
      {
        label: 'Review recent login activity',
        description: 'See successful and failed login attempts by user.',
      },
      {
        label: 'Check for suspicious access',
        description: 'Look for logins from unexpected times or locations.',
      },
    ],
  },

  // ── Settings (remainder) ─────────────────────────────────────────────────────
  '/settings/branches': {
    title: 'Branches',
    description: 'Your shop/office locations — each has its own stock and reports.',
    tasks: [
      { label: 'Add a branch', description: 'New Branch → name, code, and address.' },
      {
        label: "Set a branch's address",
        description: 'Used on invoices and other documents printed from that branch.',
      },
    ],
  },
  '/settings/warehouses': {
    title: 'Warehouses',
    description: 'Physical stock locations, usually one or more per branch.',
    tasks: [
      { label: 'Add a warehouse', description: 'New Warehouse → name, code, and branch.' },
      {
        label: 'Assign a warehouse to a branch',
        description: 'Every warehouse must belong to exactly one branch.',
      },
    ],
  },
  '/settings/sso': {
    title: 'Single Sign-On',
    description:
      "Configure SSO so your team can log in with your organization's identity provider.",
    tasks: [
      {
        label: 'Configure an SSO connection',
        description: 'Enter your identity provider’s details (SAML/OIDC).',
      },
      {
        label: 'Test the SSO login flow',
        description: 'Confirm before rolling it out to your whole team.',
      },
    ],
  },
  '/settings/integrations': {
    title: 'Integrations',
    description: 'Connect external services (WhatsApp, SMS, payment gateways) used across the app.',
    tasks: [
      {
        label: 'Connect an integration',
        description: 'Enter the credentials for the service you want to connect.',
      },
      {
        label: 'Check connection status',
        description: 'Confirm an integration is active before relying on it.',
      },
    ],
  },
  '/settings/faqs': {
    title: 'FAQs',
    description: 'Manage the frequently-asked-questions shown to your team.',
    tasks: [{ label: 'Add an FAQ entry', description: 'New FAQ → question and answer → Save.' }],
  },

  // ── Suppliers / Users ────────────────────────────────────────────────────────
  '/suppliers': {
    title: 'Suppliers',
    description: 'Your supplier master — GSTIN, contact details, and outstanding payables.',
    tasks: [
      {
        label: 'Add a new supplier',
        description: 'New Supplier → fill name, mobile, GSTIN → Save.',
      },
      {
        label: "View a supplier's outstanding balance",
        description: 'Click the supplier name for a 360° view of bills and payments.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/purchase/index.html#purchase/client/overview`,
  },
  '/users': {
    title: 'Users',
    description: 'Your team members — invite users and assign roles and permissions.',
    tasks: [
      {
        label: 'Invite a new user',
        description: 'New User → email and role → they receive an invite.',
      },
      {
        label: "Change a user's role or branch access",
        description: 'Open the user → update role or assigned branches.',
      },
    ],
  },

  // ── Admin / Platform ─────────────────────────────────────────────────────────
  '/admin/tenants': {
    title: 'Tenants',
    description: 'Create, suspend, and manage every customer organization on this platform.',
    tasks: [
      {
        label: 'Create a new tenant',
        description: '"+ New Tenant" → org details, plan, and first Owner account.',
      },
      {
        label: 'Suspend or reactivate a tenant',
        description: 'Suspending blocks login without deleting any data.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/tenants/index.html#tenants/admin/provisioning`,
  },
  '/admin/audit-logs': {
    title: 'Audit Logs',
    description: 'A record of who changed what, when, across the whole tenant.',
    tasks: [
      {
        label: 'Filter by user or date',
        description: 'Narrow down to a specific person or time window.',
      },
      {
        label: "Investigate a record's change history",
        description: 'See every edit made to a specific record over time.',
      },
    ],
  },
  '/admin/security-audit-log': {
    title: 'Security Audit Log',
    description:
      'Authentication and permission-related events — logins, failed attempts, role changes.',
    tasks: [
      {
        label: 'Review recent failed logins',
        description: 'A spike here can indicate a credential-stuffing attempt.',
      },
      {
        label: "Check who changed a role's permissions",
        description: 'Permission changes are logged with the acting user.',
      },
    ],
  },
  '/admin/feature-flags': {
    title: 'Feature Flags',
    description:
      'Turn optional modules (POS, multi-branch, e-invoice, WhatsApp notifications, etc.) on or off.',
    tasks: [
      {
        label: 'Enable a feature',
        description: 'Toggle it on — takes effect immediately, no restart needed.',
      },
      {
        label: 'Check which features are active',
        description: 'The list shows every flag and its current state.',
      },
    ],
  },
  '/admin/search-analytics': {
    title: 'Search Analytics',
    description:
      'Usage stats for the global search (Ctrl+K) — volume, no-result rate, latency, and click-through.',
    tasks: [
      {
        label: 'Review no-result queries',
        description:
          'Repeated no-result searches usually mean a vocabulary gap, not a missing record.',
      },
      {
        label: 'Retry a failed index sync',
        description: 'The Dead-Letter tab lists documents that failed to sync — Retry re-runs it.',
      },
    ],
  },
  '/admin/distributed/dlq': {
    title: 'Dead-Letter Queue',
    description:
      'Events that failed to process after retries, held here for manual retry or discard.',
    tasks: [
      {
        label: 'Retry a failed event',
        description: 'Re-runs the event through its original consumer.',
      },
      {
        label: 'Discard an event',
        description: 'Marks it resolved without retrying — use when it’s no longer relevant.',
      },
    ],
  },
  '/admin/distributed/events': {
    title: 'Event Store',
    description: "The platform's event log across every service.",
    tasks: [
      {
        label: 'Search for events',
        description: 'Filter by event type or tenant to trace a specific workflow.',
      },
    ],
    guideUrl: `${DOCS_SITE_URL}/platform/index.html#platform/dev/event-consumers`,
  },
  '/admin/distributed/sagas': {
    title: 'Saga Orchestrator',
    description:
      'Tracks multi-step, cross-service workflows (like invoice creation) and their retry state.',
    tasks: [
      {
        label: "Check a saga's current step",
        description: 'Shows exactly where a multi-step workflow currently stands.',
      },
      {
        label: 'Investigate a stuck saga',
        description: 'A saga stuck at one step usually points to a downstream service failure.',
      },
    ],
  },
  '/admin/distributed/schemas': {
    title: 'Schema Registry',
    description: 'The registered shape of every event type published on the platform.',
    tasks: [
      {
        label: "Look up an event type's schema",
        description: 'Useful when debugging a consumer that isn’t processing an event as expected.',
      },
    ],
  },
  '/admin/distributed/projections': {
    title: 'Projections',
    description: 'Read-optimized views rebuilt from the event stream (e.g. current stock levels).',
    tasks: [
      {
        label: "Check a projection's rebuild status",
        description: 'Confirms whether a projection is up to date with the event stream.',
      },
    ],
  },
  '/admin/distributed/performance': {
    title: 'Performance',
    description: 'Platform-wide latency and throughput metrics across services.',
    tasks: [
      {
        label: "Check a service's response times",
        description: 'Useful when users report the app feels slow.',
      },
    ],
  },
};

const DEFAULT_HELP: HelpContent = {
  title: 'Help',
  description: 'Press ? on any screen to see context-sensitive help for that page.',
  tasks: [
    {
      label: 'Navigate to a module',
      description: 'Use the left sidebar to navigate between modules.',
    },
    {
      label: 'Search anything',
      description: 'Use the search bar (top) to find customers, items, invoices instantly.',
    },
  ],
};

// Flattened for search — every route's title/description/tasks in one array, so a query can
// match content the user isn't currently looking at (e.g. searching "GSTIN" from /dashboard
// should surface the Customers and Organization Settings pages).
const ALL_HELP_ENTRIES: { path: string; content: HelpContent }[] = Object.entries(HELP_CONTENT).map(
  ([path, content]) => ({ path, content })
);

function matchesQuery(content: HelpContent, query: string): boolean {
  const q = query.toLowerCase();
  return (
    content.title.toLowerCase().includes(q) ||
    content.description.toLowerCase().includes(q) ||
    content.tasks.some(
      (t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  );
}

function renderTaskList(
  tasks: HelpTask[],
  keyPrefix: string,
  expandedTask: string | null,
  setExpandedTask: (v: string | null) => void
) {
  return (
    <div className="space-y-1">
      {tasks.map((task, idx) => {
        const key = `${keyPrefix}${idx}`;
        const isExpanded = expandedTask === key;
        return (
          <div key={key} className="rounded-lg border border-default overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-surface-raised transition-colors"
              onClick={() => setExpandedTask(isExpanded ? null : key)}
            >
              <span className="text-sm font-medium text-primary">{task.label}</span>
              <ChevronRight
                size={14}
                className={`text-secondary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </button>
            {isExpanded && (
              <div className="px-3 pb-3 pt-1">
                <p className="text-xs text-secondary leading-relaxed">
                  {task.description}
                  {task.link && (
                    <>
                      {' '}
                      <a href={task.link.href} className="text-link hover:underline">
                        {task.link.text}
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface HelpPanelProps {
  currentPath: string;
  onClose: () => void;
}

export function HelpPanel({ currentPath, onClose }: HelpPanelProps) {
  // Composite `${groupKey}${index}` rather than a bare index, since search results render
  // multiple task groups at once — a bare index would expand the same row in every group.
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { startTour, isTourAvailable } = useTour();
  const { data: tourProgress } = useTourProgress();
  // Split rather than one flat list: with 20+ page-specific Quick Tours now registered,
  // showing all of them on every page would bury the one tour actually relevant to where the
  // user is. "This page" matches on the tour's own first step's route — a pattern match (e.g.
  // `sales/invoices/:id`), not exact equality, so a detail-page tour shows up while viewing
  // any specific record of that type. Cross-module tours (module: 'cross-module', e.g. the
  // Purchase→Dashboard business-workflow tour) aren't tied to one page, so they always stay
  // visible under "Business workflows" instead.
  const currentPageRoute = currentPath.replace(/^\//, '');
  const pageTours = useMemo(
    () =>
      getAllTours().filter(
        (t) =>
          isTourAvailable(t) &&
          t.module !== 'cross-module' &&
          t.steps[0] !== undefined &&
          matchesRoutePattern(t.steps[0].route, currentPageRoute)
      ),
    [isTourAvailable, currentPageRoute]
  );
  const workflowTours = useMemo(
    () => getAllTours().filter((t) => isTourAvailable(t) && t.module === 'cross-module'),
    [isTourAvailable]
  );

  const content = HELP_CONTENT[currentPath] ?? DEFAULT_HELP;

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return ALL_HELP_ENTRIES.filter((e) => matchesQuery(e.content, searchQuery));
  }, [searchQuery]);

  // HelpPanel is only ever mounted while open (Layout.tsx renders it conditionally), so
  // it's open for its entire mounted lifetime — trap/restore runs on mount/unmount.
  useFocusTrap(panelRef, true);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Help — ${content.title}`}
      className="fixed inset-y-0 right-0 z-50 w-80 bg-surface-card shadow-2xl border-l border-default flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-default bg-brand">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-white" />
          <span className="text-sm font-semibold text-white">Help — {content.title}</span>
        </div>
        <button
          onClick={onClose}
          className="text-blue-200 hover:text-white transition-colors"
          aria-label="Close help panel"
        >
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Search across all help content */}
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-disabled" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search help…"
            aria-label="Search help"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-default bg-surface-page text-primary placeholder:text-placeholder focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>

        {searchResults ? (
          searchResults.length === 0 ? (
            <p className="text-sm text-secondary">
              No help topics match &ldquo;{searchQuery}&rdquo;.
            </p>
          ) : (
            <div className="space-y-4">
              {searchResults.map((entry) => (
                <div key={entry.path}>
                  <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                    {entry.content.title}
                  </p>
                  {renderTaskList(
                    entry.content.tasks,
                    `${entry.path}-`,
                    expandedTask,
                    setExpandedTask
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {/* Description */}
            <p className="text-sm text-secondary leading-relaxed">{content.description}</p>

            {/* Top 3 tasks */}
            <div>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                Top tasks on this screen
              </p>
              {renderTaskList(content.tasks, '', expandedTask, setExpandedTask)}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-default">
        {content.guideUrl && (
          <div className="px-4 pt-3">
            <a
              href={content.guideUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm text-link hover:underline"
            >
              <ExternalLink size={14} />
              Open full training guide
            </a>
          </div>
        )}
        {(pageTours.length > 0 || workflowTours.length > 0) && (
          <div className="px-4 pt-3 space-y-3 border-b border-default pb-3">
            {pageTours.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide">
                  This page
                </p>
                {pageTours.map((tour) => (
                  <TourLaunchButton
                    key={tour.id}
                    tour={tour}
                    progress={findProgress(tourProgress, tour.id)}
                    onLaunch={startTour}
                    onClose={onClose}
                  />
                ))}
              </div>
            )}
            {workflowTours.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide">
                  Business workflows
                </p>
                {workflowTours.map((tour) => (
                  <TourLaunchButton
                    key={tour.id}
                    tour={tour}
                    progress={findProgress(tourProgress, tour.id)}
                    onLaunch={startTour}
                    onClose={onClose}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        <div className="px-4 py-3 space-y-2">
          <button
            onClick={() => setShortcutsOpen(true)}
            className="flex items-center gap-2 text-sm text-link hover:underline"
          >
            <Keyboard size={14} />
            Keyboard shortcuts
          </button>
          <button
            onClick={() => setWhatsNewOpen(true)}
            className="flex items-center gap-2 text-sm text-link hover:underline"
          >
            <Sparkles size={14} />
            What&rsquo;s new
          </button>
          <a
            href="mailto:nexoraatech.seo@gmail.com"
            className="flex items-center gap-2 text-sm text-link hover:underline"
          >
            <Mail size={14} />
            Contact support
          </a>
          <a
            href="mailto:nexoraatech.seo@gmail.com?subject=Issue%20report"
            className="flex items-center gap-2 text-sm text-link hover:underline"
          >
            <Flag size={14} />
            Report an issue
          </a>
          {hasPermission(PERMISSIONS.PERFORMANCE_VIEW) && (
            <a
              href="/admin/distributed/performance"
              className="flex items-center gap-2 text-sm text-link hover:underline"
            >
              <Activity size={14} />
              System diagnostics
            </a>
          )}
        </div>
        <p className="px-4 pb-3 text-xs text-disabled">
          NEXORAA ERP v{__APP_VERSION__} &middot; {import.meta.env.MODE}
        </p>
      </div>

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <WhatsNewModal open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
    </div>
  );
}

export default HelpPanel;
