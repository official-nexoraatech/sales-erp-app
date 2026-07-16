import SEO from '../../components/marketing/SEO.js';
import PublicLayout from './PublicLayout.js';
import Hero from './components/Hero.js';
import TrustedByStrip from './components/TrustedByStrip.js';
import ProductModulesGrid from './components/ProductModulesGrid.js';
import WhyChooseUs from './components/WhyChooseUs.js';
import IndustriesSection from './components/IndustriesSection.js';
import FeatureShowcase from './components/FeatureShowcase.js';
import SmartSearchSection from './components/SmartSearchSection.js';
import IntegrationsSection from './components/IntegrationsSection.js';
import TestimonialsSection from './components/TestimonialsSection.js';
import PricingPreview from './components/PricingPreview.js';
import SecuritySection from './components/SecuritySection.js';
import FAQSection from './components/FAQSection.js';
import CTASection from './components/CTASection.js';

export default function LandingPage() {
  return (
    <PublicLayout>
      <SEO
        title="Enterprise ERP for growing businesses"
        description="Sales, purchase, inventory, accounting, GST compliance, HR and CRM — unified in one multi-tenant ERP platform."
        path="/"
      />
      <Hero />
      <TrustedByStrip />
      <ProductModulesGrid />
      <WhyChooseUs />
      <IndustriesSection />
      <FeatureShowcase />
      <SmartSearchSection />
      <IntegrationsSection />
      <TestimonialsSection />
      <PricingPreview />
      <SecuritySection />
      <FAQSection />
      <CTASection />
    </PublicLayout>
  );
}
