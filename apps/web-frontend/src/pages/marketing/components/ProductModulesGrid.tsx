import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import {
  ReceiptText,
  ShoppingCart,
  Boxes,
  Calculator,
  FileCheck2,
  Users,
  Megaphone,
  Factory,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';

export const MODULES = [
  {
    id: 'sales',
    icon: ReceiptText,
    title: 'Sales & Invoicing',
    description: 'Quotations, invoices, delivery challans, payments and returns in one flow.',
  },
  {
    id: 'purchase',
    icon: ShoppingCart,
    title: 'Purchase & Procurement',
    description: 'Purchase orders, GRNs, supplier payments and returns, fully tracked.',
  },
  {
    id: 'inventory',
    icon: Boxes,
    title: 'Inventory & Warehousing',
    description: 'Multi-branch stock, transfers, adjustments and physical verification.',
  },
  {
    id: 'accounting',
    icon: Calculator,
    title: 'Accounting & Finance',
    description: 'Ledgers, trial balance, P&L, balance sheet and cash flow — always current.',
  },
  {
    id: 'gst',
    icon: FileCheck2,
    title: 'GST & Compliance',
    description:
      'GSTR-1, GSTR-3B, GSTR-9, e-Invoice generation and GSTR-2A reconciliation, built in.',
  },
  {
    id: 'hr',
    icon: Users,
    title: 'HR & Payroll',
    description: 'Employees, attendance, leave, payroll runs, PF/ESI challans and Form 16.',
  },
  {
    id: 'crm',
    icon: Megaphone,
    title: 'CRM & Campaigns',
    description: 'Customer segments, campaigns and seasonal promotions that drive repeat sales.',
  },
  {
    id: 'production',
    icon: Factory,
    title: 'Production & Job Work',
    description: 'Job work orders, consignment stock, reorder planning and barcode labels.',
  },
  {
    id: 'reports',
    icon: BarChart3,
    title: 'Reports & Analytics',
    description: 'Sales, inventory and HR analytics with scheduled report delivery.',
  },
  {
    id: 'security',
    icon: ShieldCheck,
    title: 'Security & Administration',
    description: 'Role-based access control, audit logging, MFA and tenant administration.',
  },
];

function ModuleCard({
  id,
  icon,
  title,
  description,
  index,
}: (typeof MODULES)[number] & { index: number }) {
  const { ref, isVisible } = useScrollReveal<HTMLAnchorElement>();
  return (
    <Link
      ref={ref}
      to={`/features#${id}`}
      style={{ transitionDelay: isVisible ? `${Math.min(index, 6) * 60}ms` : '0ms' }}
      className={`group relative rounded-2xl border border-default bg-surface-card p-6 hover:-translate-y-1 hover:border-brand hover:shadow-token-lg transition-all duration-slow ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <ArrowUpRight className="absolute top-6 right-6 h-4 w-4 text-secondary opacity-0 group-hover:opacity-100 transition-opacity duration-normal" />
      <ModuleGlyph icon={icon} size="lg" />
      <h3 className="mt-4 text-base font-semibold text-primary group-hover:text-brand transition-colors">
        {title}
      </h3>
      <p className="mt-1.5 text-sm text-secondary pr-5">{description}</p>
    </Link>
  );
}

export default function ProductModulesGrid() {
  return (
    <MarketingSection surface="light" className="py-24" id="modules">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">Platform</span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          One platform, every department
        </h2>
        <p className="mt-3 text-secondary">
          Every module shares the same data, permissions and reporting layer — no duct-taped
          integrations between disconnected tools.
        </p>
      </div>

      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {MODULES.map((m, index) => (
          <ModuleCard key={m.id} {...m} index={index} />
        ))}
      </div>
    </MarketingSection>
  );
}
