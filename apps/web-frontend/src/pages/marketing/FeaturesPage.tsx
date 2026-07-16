import { Check } from 'lucide-react';
import SEO from '../../components/marketing/SEO.js';
import PublicLayout from './PublicLayout.js';
import MarketingSection from '../../components/marketing/MarketingSection.js';
import ModuleGlyph from '../../components/marketing/ModuleGlyph.js';
import { MODULES } from './components/ProductModulesGrid.js';
import { FEATURE_DETAILS } from './components/featureDetails.js';
import SmartSearchSection from './components/SmartSearchSection.js';
import IntegrationsSection from './components/IntegrationsSection.js';
import SecuritySection from './components/SecuritySection.js';
import CTASection from './components/CTASection.js';

export default function FeaturesPage() {
  return (
    <PublicLayout>
      <SEO
        title="Features"
        description="Every ERP module you need — sales, purchase, inventory, accounting, GST, HR, CRM and production — in one platform."
        path="/features"
      />
      <MarketingSection surface="ink" className="py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="font-display font-semibold text-display-md text-marketing-ink">
            Everything your business needs
          </h1>
          <p className="mt-4 text-marketing-ink-muted">
            A single platform covering every department, with shared data and permissions across the
            board — not a bundle of point solutions stitched together.
          </p>
        </div>
      </MarketingSection>

      <MarketingSection surface="light" className="py-20" containerClassName="space-y-20">
        {/* Security has its own dedicated, richer section below — skip its module entry here. */}
        {MODULES.filter((m) => m.id !== 'security').map(({ id, icon, title, description }) => (
          <div key={id} id={id} className="scroll-mt-24 grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <ModuleGlyph icon={icon} size="lg" />
              <h2 className="mt-4 text-2xl font-display font-semibold text-primary">{title}</h2>
              <p className="mt-2 text-secondary">{description}</p>
            </div>
            <ul className="lg:col-span-2 grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {(FEATURE_DETAILS[id] ?? []).map((detail) => (
                <li key={detail} className="flex items-start gap-2 text-sm text-primary">
                  <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  {detail}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </MarketingSection>

      <SmartSearchSection />
      <IntegrationsSection />
      <SecuritySection />
      <CTASection />
    </PublicLayout>
  );
}
