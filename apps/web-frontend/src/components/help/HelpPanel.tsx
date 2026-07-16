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
    guideUrl: `${DOCS_SITE_URL}/accounting/index.html#accounting/client/overview`,
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
            href="mailto:support@nexoraa.com"
            className="flex items-center gap-2 text-sm text-link hover:underline"
          >
            <Mail size={14} />
            Contact support
          </a>
          <a
            href="mailto:support@nexoraa.com?subject=Issue%20report"
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
