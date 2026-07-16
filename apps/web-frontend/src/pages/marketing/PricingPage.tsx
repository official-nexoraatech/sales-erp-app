import SEO from '../../components/marketing/SEO.js';
import PublicLayout from './PublicLayout.js';
import MarketingSection from '../../components/marketing/MarketingSection.js';
import PricingPreview from './components/PricingPreview.js';
import PricingComparisonTable from './components/PricingComparisonTable.js';
import FAQSection from './components/FAQSection.js';
import CTASection from './components/CTASection.js';

export default function PricingPage() {
  return (
    <PublicLayout>
      <SEO
        title="Pricing"
        description="Simple, transparent NEXORAA ERP pricing — start free, upgrade as you grow."
        path="/pricing"
      />
      <MarketingSection surface="ink" className="py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="font-display font-semibold text-display-md text-marketing-ink">
            Plans that grow with you
          </h1>
          <p className="mt-4 text-marketing-ink-muted">
            Start on Starter for free. Talk to us for Growth or Enterprise.
          </p>
        </div>
      </MarketingSection>
      <PricingPreview />
      <PricingComparisonTable />
      <FAQSection />
      <CTASection />
    </PublicLayout>
  );
}
