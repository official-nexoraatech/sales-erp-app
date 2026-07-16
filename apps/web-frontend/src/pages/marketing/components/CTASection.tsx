import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Button from '../../../components/ui/Button.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

/** The other "ink" brand moment, deliberately different from Hero: no floating dashboard
 * mock, no rotating claim — a single, quiet grid-pattern backdrop and one direct ask, so the
 * page opens and closes on the same brand surface without the two sections reading as
 * identical (the old version literally reused Hero's gradient string verbatim). */
export default function CTASection() {
  const navigate = useNavigate();
  return (
    <MarketingSection surface="ink" className="py-24">
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(var(--marketing-ink-border) 1px, transparent 1px), linear-gradient(90deg, var(--marketing-ink-border) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden="true"
      />
      <div className="relative text-center max-w-2xl mx-auto">
        <h2 className="font-display font-semibold text-display-sm text-marketing-ink">
          Ready to run your business on one platform?
        </h2>
        <p className="mt-4 text-marketing-ink-muted">
          Create your workspace in minutes. No credit card required.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            size="lg"
            className="justify-center bg-accent hover:bg-accent-hover text-accent-fg border-0"
            onClick={() => navigate('/signup')}
          >
            Start Free Trial <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="justify-center text-white hover:bg-white/10 hover:text-white"
            onClick={() => navigate('/contact')}
          >
            Talk to Sales
          </Button>
        </div>
      </div>
    </MarketingSection>
  );
}
