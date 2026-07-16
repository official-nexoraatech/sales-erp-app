import MarketingSection from '../../../components/marketing/MarketingSection.js';

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

export default function TrustedByStrip() {
  return (
    <MarketingSection surface="card" className="py-10">
      <p className="text-center text-xs font-medium uppercase tracking-widest text-secondary mb-6">
        Built for growing, multi-branch businesses like
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {EXAMPLE_COMPANIES.map((name) => (
          <span key={name} className="font-display text-base font-medium text-disabled">
            {name}
          </span>
        ))}
      </div>
    </MarketingSection>
  );
}
