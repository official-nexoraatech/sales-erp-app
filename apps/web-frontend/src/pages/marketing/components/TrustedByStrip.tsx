import MarketingSection from '../../../components/marketing/MarketingSection.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';

// Illustrative example companies only — not real customers. Swap for real logos once
// live customer references are available.
const EXAMPLE_COMPANIES = [
  'Meridian Retail Group',
  'Aarav Textiles Ltd.',
  'Northfield Distribution',
  'Solaris Manufacturing',
  'Baywood Traders',
  'Crestline Apparel Co.',
];

function CompanyChip({ name, index }: { name: string; index: number }) {
  const { ref, isVisible } = useScrollReveal<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      style={{ transitionDelay: isVisible ? `${Math.min(index, 6) * 60}ms` : '0ms' }}
      className={`font-display text-sm font-medium text-disabled rounded-full border border-default bg-surface-card px-4 py-1.5 transition-all duration-slow ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      {name}
    </span>
  );
}

export default function TrustedByStrip() {
  return (
    <MarketingSection surface="card" className="py-10">
      <p className="text-center text-xs font-medium uppercase tracking-widest text-secondary mb-6">
        Built for growing, multi-branch businesses like
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {EXAMPLE_COMPANIES.map((name, index) => (
          <CompanyChip key={name} name={name} index={index} />
        ))}
      </div>
    </MarketingSection>
  );
}
