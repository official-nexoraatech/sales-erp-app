import { Quote } from 'lucide-react';
import MarketingSection from '../../../components/marketing/MarketingSection.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';

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

function TestimonialCard({
  quote,
  name,
  role,
  index,
}: (typeof TESTIMONIALS)[number] & { index: number }) {
  const { ref, isVisible } = useScrollReveal<HTMLElement>();
  return (
    <figure
      ref={ref}
      style={{ transitionDelay: isVisible ? `${Math.min(index, 6) * 60}ms` : '0ms' }}
      className={`rounded-2xl border border-default bg-surface-page p-6 shadow-token-sm transition-all duration-slow hover:-translate-y-1 hover:border-brand hover:shadow-token-lg ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <Quote className="h-6 w-6 text-brand/40" aria-hidden="true" />
      <blockquote className="mt-3 text-sm text-primary leading-relaxed">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-4 text-xs text-secondary">
        <span className="font-semibold text-primary">{name}</span> &middot; {role}
      </figcaption>
    </figure>
  );
}

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
        {TESTIMONIALS.map((testimonial, index) => (
          <TestimonialCard key={testimonial.name} {...testimonial} index={index} />
        ))}
      </div>
    </MarketingSection>
  );
}
