import { Sparkles, TrendingUp, SearchCheck } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

const POINTS = [
  {
    icon: TrendingUp,
    title: 'Learns from how your team searches',
    description:
      'Results you and your teammates click on for a given search rank higher next time — no configuration required.',
  },
  {
    icon: SearchCheck,
    title: '"Did you mean" suggestions',
    description:
      'When a search returns nothing, we suggest the closest query your team has actually searched for before.',
  },
];

export default function SmartSearchSection() {
  return (
    <MarketingSection surface="card" className="py-24" id="smart-search">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-xs font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" /> Smart Search
          </span>
          <h2 className="mt-4 font-display font-semibold text-display-sm text-primary">
            Search that gets smarter every day
          </h2>
          <p className="mt-3 text-secondary max-w-lg">
            Global search across customers, invoices, items and more — with ranking that adapts to
            your team&apos;s real usage patterns and typo-tolerant matching out of the box.
          </p>
          <div className="mt-8 space-y-5">
            {POINTS.map(({ icon, title, description }) => (
              <div key={title} className="flex gap-3">
                <ModuleGlyph icon={icon} size="sm" variant="accent" />
                <div>
                  <h3 className="text-sm font-semibold text-primary">{title}</h3>
                  <p className="text-sm text-secondary mt-0.5">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-accent/30 bg-surface-page p-6 shadow-token-md">
          <div className="rounded-lg border border-default bg-surface-card px-4 py-3 text-sm text-secondary">
            Search customers, invoices, items&hellip;
          </div>
          <ul className="mt-3 space-y-2">
            <li className="rounded-lg px-4 py-2.5 bg-accent-subtle text-sm text-primary flex items-center justify-between">
              <span>Aarav Textiles — Invoice #INV-2298</span>
              <span className="text-xs text-accent font-medium">Frequently opened</span>
            </li>
            <li className="rounded-lg px-4 py-2.5 text-sm text-secondary">
              Aarav Textiles — Customer profile
            </li>
            <li className="rounded-lg px-4 py-2.5 text-sm text-secondary">
              Aarav Fabrics — Purchase Order #PO-1187
            </li>
          </ul>
        </div>
      </div>
    </MarketingSection>
  );
}
