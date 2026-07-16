import { Shirt, Store, Factory } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

// Grounded in real, vertical-specific modules confirmed in the codebase — not a generic
// 10-industry list. Fabric-roll/alteration tracking, POS, and job-work/consignment are real,
// working features, not aspirational category copy.
const INDUSTRIES = [
  {
    icon: Shirt,
    name: 'Textiles & Apparel',
    description:
      'Length-based fabric roll tracking with cut history, plus a dedicated tailor work log and alteration order management.',
  },
  {
    icon: Store,
    name: 'Retail & Multi-Branch',
    description:
      'A full point-of-sale flow — held sales, quick items, customer search, UPI — backed by the same inventory and accounting every branch shares.',
  },
  {
    icon: Factory,
    name: 'Manufacturing & Job Work',
    description:
      'Job-work orders with materials-issue and quality-check stages, consignment stock and settlements, and automatic reorder-to-PO generation.',
  },
];

export default function IndustriesSection() {
  return (
    <MarketingSection surface="light" className="py-24">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">
          Built for your workflow
        </span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          Not a generic ERP — built for how you actually work
        </h2>
      </div>
      <div className="mt-14 grid md:grid-cols-3 gap-6">
        {INDUSTRIES.map(({ icon, name, description }) => (
          <div key={name} className="rounded-2xl border border-default bg-surface-card p-7">
            <ModuleGlyph icon={icon} size="lg" variant="accent" />
            <h3 className="mt-4 text-lg font-semibold text-primary">{name}</h3>
            <p className="mt-2 text-sm text-secondary">{description}</p>
          </div>
        ))}
      </div>
    </MarketingSection>
  );
}
