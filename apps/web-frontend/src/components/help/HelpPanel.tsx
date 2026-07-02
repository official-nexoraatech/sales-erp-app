import { useState } from 'react';
import { X, ExternalLink, BookOpen, ChevronRight } from 'lucide-react';

interface HelpTask {
  label: string;
  description: string;
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
    description: 'Your business at a glance — today\'s sales, collections, alerts, and KPIs.',
    tasks: [
      { label: 'Read today\'s sales', description: 'The "Today\'s Sales" card shows all confirmed invoices billed today.' },
      { label: 'See overdue customers', description: 'Check the Outstanding Receivables widget. Click to see aging detail.' },
      { label: 'Approve pending items', description: 'The Approvals badge (bell icon, top right) shows items waiting for your action.' },
    ],
    guideUrl: '/docs/training/OWNER_GUIDE.md#module-1',
  },
  '/sales/invoices': {
    title: 'Invoices',
    description: 'Create and manage customer invoices with automatic GST calculation.',
    tasks: [
      { label: 'Create a new invoice', description: 'Click "New Invoice" → select customer → add items → Confirm.' },
      { label: 'Record payment for an invoice', description: 'Open the invoice → click "Record Payment" → enter amount and mode.' },
      { label: 'Cancel an invoice', description: 'Open invoice → Actions → Cancel. Only DRAFT invoices can be deleted; CONFIRMED invoices require a Sale Return.' },
    ],
    guideUrl: '/docs/training/CASHIER_GUIDE.md#module-2',
  },
  '/sales/pos': {
    title: 'POS Terminal',
    description: 'Fast billing at the counter — barcode scan, split payment, instant receipt.',
    tasks: [
      { label: 'Scan a barcode', description: 'Click the search box and scan with barcode scanner — item adds to bill automatically.' },
      { label: 'Process split payment', description: 'In payment modal, click "Split" — enter amounts for Cash, UPI, and Card separately.' },
      { label: 'Send WhatsApp receipt', description: 'After payment, click "WhatsApp" — customer receives digital receipt instantly.' },
    ],
    guideUrl: '/docs/training/CASHIER_GUIDE.md#module-1',
  },
  '/sales/returns': {
    title: 'Sale Returns',
    description: 'Process customer returns — stock is restored and a credit note is created automatically.',
    tasks: [
      { label: 'Create a return', description: 'Click "New Return" → search the original invoice → select returned items → Confirm.' },
      { label: 'Apply credit note', description: 'The credit note appears on the customer account. Apply it on the customer\'s next invoice.' },
    ],
    guideUrl: '/docs/training/CASHIER_GUIDE.md#module-3',
  },
  '/purchase/orders': {
    title: 'Purchase Orders',
    description: 'Create POs for suppliers — required before receiving goods.',
    tasks: [
      { label: 'Create a purchase order', description: 'New PO → select supplier → add items with quantity and rate → Submit.' },
      { label: 'Send PO to supplier', description: 'Open approved PO → Download PDF → Email or WhatsApp to supplier.' },
      { label: 'Receive goods against PO', description: 'Go to Purchase → GRN → New → search this PO → enter received quantities.' },
    ],
    guideUrl: '/docs/training/PURCHASE_MANAGER_GUIDE.md#module-1',
  },
  '/purchase/grns': {
    title: 'Goods Receipt Notes (GRN)',
    description: 'Record goods received from suppliers — stock increases only after GRN is confirmed.',
    tasks: [
      { label: 'Create a GRN', description: 'New GRN → select the Purchase Order → verify quantities received → Confirm.' },
      { label: 'Handle price variance', description: 'If received rate differs from PO rate by >5%, GRN needs owner approval.' },
    ],
    guideUrl: '/docs/training/PURCHASE_MANAGER_GUIDE.md#module-2',
  },
  '/accounting/bank-reconciliation': {
    title: 'Bank Reconciliation',
    description: 'Match your bank statement with ERP entries to ensure books are accurate.',
    tasks: [
      { label: 'Import bank statement', description: 'Click "Import Statement" → upload CSV/Excel from your bank\'s internet banking.' },
      { label: 'Auto-match entries', description: 'Click "Auto-Match" — system matches by amount, date, and reference number.' },
      { label: 'Finalize reconciliation', description: 'After all entries are matched, click "Finalize" to lock the period.' },
    ],
    guideUrl: '/docs/training/ACCOUNTANT_GUIDE.md#module-2',
  },
  '/gst/gstr1': {
    title: 'GSTR-1 (Sales Return)',
    description: 'Monthly GST return for all outward supplies — due 11th of next month.',
    tasks: [
      { label: 'Verify period invoices', description: 'Check the B2B and B2C summary matches your Sales report for the same period.' },
      { label: 'Export GSTR-1', description: 'Click "Export" → download JSON → upload on gst.gov.in portal.' },
      { label: 'Check GSTIN is filled', description: 'B2B invoices without GSTIN go to B2C — update customer masters if needed.' },
    ],
    guideUrl: '/docs/training/ACCOUNTANT_GUIDE.md#module-3',
  },
  '/gst/gstr3b': {
    title: 'GSTR-3B (Summary Return)',
    description: 'Monthly summary return — shows net tax payable after ITC. Due 20th of next month.',
    tasks: [
      { label: 'Review tax liability', description: 'Section 3.1 shows your outward tax. Section 4A shows ITC from purchases.' },
      { label: 'Calculate net tax', description: 'Net tax = 3.1 total − 4A total. This amount must be paid on GST portal.' },
      { label: 'Export and file', description: 'Download Excel → cross-check → file on GST portal → pay net tax.' },
    ],
    guideUrl: '/docs/training/ACCOUNTANT_GUIDE.md#module-3',
  },
  '/hr/payroll': {
    title: 'Payroll',
    description: 'Process monthly salary — calculate, approve, generate slips, and bank transfer file.',
    tasks: [
      { label: 'Start payroll run', description: 'New Payroll Run → select month → Calculate → review each employee\'s net salary.' },
      { label: 'Submit for approval', description: 'After review, click "Submit for Approval" — owner receives notification to approve.' },
      { label: 'Generate salary slips', description: 'After approval → Generate Salary Slips → email or WhatsApp to all employees.' },
    ],
    guideUrl: '/docs/training/HR_MANAGER_GUIDE.md#module-4',
  },
  '/hr/attendance': {
    title: 'Attendance',
    description: 'Record daily attendance — required before running payroll each month.',
    tasks: [
      { label: 'Mark daily attendance', description: 'Select date and branch → mark each employee P / A / HD → Save.' },
      { label: 'Import from file', description: 'Download template → fill → Upload — for bulk attendance entry.' },
      { label: 'Review monthly summary', description: 'Monthly Summary view shows totals before payroll processing.' },
    ],
    guideUrl: '/docs/training/HR_MANAGER_GUIDE.md#module-2',
  },
  '/customers': {
    title: 'Customers',
    description: 'Manage your customer master — GSTIN, credit limits, outstanding balances.',
    tasks: [
      { label: 'Add a new customer', description: 'Click "New Customer" → fill name, mobile, GSTIN (for B2B) → Save.' },
      { label: 'Set credit limit', description: 'Open customer → Edit → set Credit Limit → system will block invoices above this.' },
      { label: 'View customer account', description: 'Click customer name → 360° view: invoices, payments, outstanding, history.' },
    ],
  },
  '/settings/organization': {
    title: 'Organization Settings',
    description: 'Your company details — GSTIN, address, logo, financial year settings.',
    tasks: [
      { label: 'Update GSTIN', description: 'Enter your 15-character GSTIN — required for all tax invoices.' },
      { label: 'Configure GST state', description: 'Set your registered state — determines CGST+SGST vs IGST calculation.' },
      { label: 'Upload company logo', description: 'Logo appears on all PDFs — invoices, POs, salary slips.' },
    ],
    guideUrl: '/docs/training/OWNER_GUIDE.md#module-5',
  },
};

const DEFAULT_HELP: HelpContent = {
  title: 'Help',
  description: 'Press ? on any screen to see context-sensitive help for that page.',
  tasks: [
    { label: 'Navigate to a module', description: 'Use the left sidebar to navigate between modules.' },
    { label: 'Search anything', description: 'Use the search bar (top) to find customers, items, invoices instantly.' },
    { label: 'Contact support', description: 'Call 1800-XXX-XXXX or chat via the support widget (bottom right).' },
  ],
};

// ── Component ─────────────────────────────────────────────────────────────────

interface HelpPanelProps {
  currentPath: string;
  onClose: () => void;
}

export function HelpPanel({ currentPath, onClose }: HelpPanelProps) {
  const [expandedTask, setExpandedTask] = useState<number | null>(null);

  const content = HELP_CONTENT[currentPath] ?? DEFAULT_HELP;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white dark:bg-neutral-900 shadow-2xl border-l border-neutral-200 dark:border-neutral-700 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 bg-blue-600 dark:bg-blue-700">
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
        {/* Description */}
        <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
          {content.description}
        </p>

        {/* Top 3 tasks */}
        <div>
          <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
            Top tasks on this screen
          </p>
          <div className="space-y-1">
            {content.tasks.map((task, idx) => (
              <div key={idx} className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                  onClick={() => setExpandedTask(expandedTask === idx ? null : idx)}
                >
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {task.label}
                  </span>
                  <ChevronRight
                    size={14}
                    className={`text-neutral-400 transition-transform ${expandedTask === idx ? 'rotate-90' : ''}`}
                  />
                </button>
                {expandedTask === idx && (
                  <div className="px-3 pb-3 pt-1">
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                      {task.description}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      {content.guideUrl && (
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700">
          <a
            href={content.guideUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink size={14} />
            Open full training guide
          </a>
        </div>
      )}
    </div>
  );
}

export default HelpPanel;
