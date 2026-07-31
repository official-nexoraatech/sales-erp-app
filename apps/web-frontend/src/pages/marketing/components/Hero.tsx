import MarketingSection from '../../../components/marketing/MarketingSection.js';
import RequestDemoForm from './RequestDemoForm.js';
import ErpSolutionGraphic from './ErpSolutionGraphic.js';

/** Landing-page hero — a lead-capture "Request For Demo" form paired with a decorative
 * All-in-One ERP Solution graphic (Retail/Distribution/Manufacturing), replacing the previous
 * headline+CTA hero. The form is the page's sole primary action; see RequestDemoForm.tsx for
 * the submission flow and ErpSolutionGraphic.tsx for the illustration. */
export default function Hero() {
  return (
    <MarketingSection glow className="py-16 lg:py-24">
      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <RequestDemoForm />
        <ErpSolutionGraphic />
      </div>
    </MarketingSection>
  );
}
