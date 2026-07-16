import MarketingSection from '../../../components/marketing/MarketingSection.js';

// Illustrative example quotes only — not real customers. Replace with real testimonials
// once available.
const TESTIMONIALS = [
  {
    quote:
      'We replaced four disconnected spreadsheet workflows with one system. GST return prep that used to take days now takes an afternoon.',
    name: 'Priya Sharma',
    role: 'Finance Lead, Meridian Retail Group',
  },
  {
    quote:
      'Stock visibility across our branches used to be a phone-call exercise. Now everyone sees the same numbers, in real time.',
    name: 'Rohan Verma',
    role: 'Operations Manager, Northfield Distribution',
  },
  {
    quote:
      'Role-based access meant we could finally let our warehouse team self-serve without touching finance data.',
    name: 'Ananya Iyer',
    role: 'IT Manager, Solaris Manufacturing',
  },
];

export default function TestimonialsSection() {
  return (
    <MarketingSection surface="card" className="py-24">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">
          Customer stories
        </span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          What teams say
        </h2>
        <p className="mt-2 text-xs text-secondary">
          Illustrative example, not a real customer quote.
        </p>
      </div>
      <div className="mt-14 grid md:grid-cols-3 gap-6">
        {TESTIMONIALS.map(({ quote, name, role }) => (
          <figure key={name} className="rounded-2xl border border-default bg-surface-page p-6">
            <blockquote className="text-sm text-primary leading-relaxed">
              &ldquo;{quote}&rdquo;
            </blockquote>
            <figcaption className="mt-4 text-xs text-secondary">
              <span className="font-semibold text-primary">{name}</span> &middot; {role}
            </figcaption>
          </figure>
        ))}
      </div>
    </MarketingSection>
  );
}
