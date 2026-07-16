import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search } from 'lucide-react';
import { faqApi } from '../../../api/endpoints.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

/** Backend-driven — see apps/tenant-service/src/api/faq.routes.ts (GET /public/faqs) and
 * the faq_items table. Replaces the previously hardcoded FAQS array; content is now managed
 * from Settings > FAQ Management by anyone holding PLATFORM_CONTENT_MANAGE. */
export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [query, setQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['public-faqs'],
    queryFn: () => faqApi.listPublic(),
    staleTime: 60_000,
  });
  const faqs = data?.content ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter(
      (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
    );
  }, [query, faqs]);

  return (
    <MarketingSection surface="light" className="py-24" containerClassName="max-w-3xl" id="faq">
      <div className="text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">FAQ</span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          Frequently asked questions
        </h2>
      </div>

      <div className="mt-8 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search FAQs&hellip;"
          aria-label="Search FAQs"
          className="w-full rounded-lg border border-default bg-surface-card pl-9 pr-3 py-2.5 text-sm text-primary placeholder:text-placeholder focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
        />
      </div>

      {isLoading ? (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading FAQs">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-surface-raised animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="mt-6 divide-y divide-default border-t border-b border-default">
          {filtered.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={faq.id}>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-4 py-4 text-left"
                  aria-expanded={isOpen}
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                >
                  <span className="text-sm font-medium text-primary">{faq.question}</span>
                  <ChevronDown
                    className={`h-4 w-4 text-secondary shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && <p className="pb-4 text-sm text-secondary">{faq.answer}</p>}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-6 text-sm text-secondary text-center">No matching questions found.</p>
          )}
        </div>
      )}
    </MarketingSection>
  );
}
