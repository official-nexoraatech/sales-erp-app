import { CheckCircle2 } from 'lucide-react';
import MarketingSection from '../../../components/marketing/MarketingSection.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';

function InventoryMock() {
  const rows = [
    { label: 'Mumbai HQ', pct: 82 },
    { label: 'Pune Branch', pct: 46 },
    { label: 'Bangalore Warehouse', pct: 91 },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-secondary">Stock coverage by branch</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> Example
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs text-secondary mb-1">
            <span>{r.label}</span>
            <span className="font-medium text-primary">{r.pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-surface-subtle overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-slow"
              style={{ width: `${r.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function LedgerMock() {
  const rows = [
    { account: 'Sales Revenue', debit: '—', credit: '4,82,000' },
    { account: 'Accounts Receivable', debit: '4,82,000', credit: '—' },
    { account: 'Input GST Credit', debit: '18,240', credit: '—' },
  ];
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold text-secondary border-b border-default pb-2 mb-2">
        <span>Account</span>
        <span className="flex gap-8">
          <span>Debit</span>
          <span>Credit</span>
        </span>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.account} className="flex justify-between text-sm">
            <span className="text-primary">{r.account}</span>
            <span className="flex gap-8 tabular-nums text-secondary">
              <span className="w-16 text-right">{r.debit}</span>
              <span className="w-16 text-right">{r.credit}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-default flex justify-between text-xs">
        <span className="text-secondary">Trial balance</span>
        <span className="font-semibold text-success">Balanced ✓</span>
      </div>
    </div>
  );
}

function GstTimelineMock() {
  const steps = [
    { label: 'GSTR-1 prepared from invoices', done: true },
    { label: 'GSTR-2A reconciled', done: true },
    { label: 'GSTR-3B ready for filing', done: false },
  ];
  return (
    <div className="space-y-4">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-start gap-3">
          <span className="flex flex-col items-center">
            <CheckCircle2 className={`h-5 w-5 ${s.done ? 'text-success' : 'text-disabled'}`} />
            {i < steps.length - 1 && (
              <span className="w-px flex-1 bg-[var(--border-default)] mt-1" />
            )}
          </span>
          <span className={`text-sm pt-0.5 ${s.done ? 'text-primary' : 'text-secondary'}`}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}

const SHOWCASES = [
  {
    eyebrow: 'Inventory',
    title: 'Know your stock, everywhere, in real time',
    description:
      'Track stock across every branch and warehouse, run physical verifications, and move goods between locations with a full audit trail — no spreadsheets, no guesswork.',
    Mock: InventoryMock,
  },
  {
    eyebrow: 'Accounting',
    title: 'Books that close themselves',
    description:
      'Every sale, purchase and payment posts straight to the ledger. Trial balance, P&L, balance sheet and cash flow are always live, not a month-end scramble.',
    Mock: LedgerMock,
  },
  {
    eyebrow: 'Compliance',
    title: 'GST filing without the spreadsheet gymnastics',
    description:
      'GSTR-1, GSTR-3B and GSTR-9 return data is generated straight from your transactions, with GSTR-2A reconciliation built in — you review and file, we do the assembly.',
    Mock: GstTimelineMock,
  },
];

function ShowcaseRow({
  eyebrow,
  title,
  description,
  Mock,
  index,
}: (typeof SHOWCASES)[number] & { index: number }) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`grid lg:grid-cols-2 gap-10 items-center transition-all duration-slow ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${index % 2 === 1 ? 'lg:[direction:rtl]' : ''}`}
    >
      <div className="lg:[direction:ltr]">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">{eyebrow}</span>
        <h3 className="mt-2 font-display font-semibold text-2xl text-primary">{title}</h3>
        <p className="mt-3 text-secondary max-w-lg">{description}</p>
      </div>
      <div className="lg:[direction:ltr] rounded-2xl border border-default bg-surface-card shadow-token-sm p-6 min-h-[220px] flex flex-col justify-center">
        <Mock />
      </div>
    </div>
  );
}

export default function FeatureShowcase() {
  return (
    <MarketingSection surface="light" className="py-24" containerClassName="space-y-24">
      <p className="text-center text-xs text-secondary">
        Illustrative example data shown throughout — not a live tenant.
      </p>
      {SHOWCASES.map((s, i) => (
        <ShowcaseRow key={s.eyebrow} {...s} index={i} />
      ))}
    </MarketingSection>
  );
}
