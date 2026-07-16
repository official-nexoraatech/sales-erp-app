import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles, Receipt, Boxes, TrendingUp } from 'lucide-react';
import Button from '../../../components/ui/Button.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';
import { useCountUp } from '../../../hooks/useCountUp.js';
import { useTheme } from '../../../context/ThemeContext.js';

const ROTATING_CLAIMS = [
  'one connected platform.',
  'a single source of truth.',
  'real-time, not month-end.',
];

const STATS = [
  { value: 29, suffix: '', label: 'connected modules' },
  { value: 15, suffix: '', label: 'independently scaling services' },
  { value: 99.9, suffix: '%', label: 'target platform uptime' },
];

function RotatingClaim() {
  const { reducedMotion } = useTheme();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % ROTATING_CLAIMS.length), 3200);
    return () => clearInterval(id);
  }, [reducedMotion]);

  return (
    <span className="relative inline-grid">
      {ROTATING_CLAIMS.map((claim, i) => (
        <span
          key={claim}
          aria-hidden="true"
          className={`col-start-1 row-start-1 transition-opacity duration-slow ${
            i === index ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {claim}
        </span>
      ))}
      <span className="sr-only">{ROTATING_CLAIMS[index]}</span>
    </span>
  );
}

function StatCounter({ value, suffix, label }: (typeof STATS)[number]) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  const count = useCountUp(value * 10, isVisible, 1400);
  return (
    <div ref={ref}>
      <dt className="sr-only">{label}</dt>
      <dd className="text-2xl font-display font-semibold text-white">
        {(count / 10).toFixed(value % 1 !== 0 ? 1 : 0)}
        {suffix}
      </dd>
      <dd className="text-xs text-marketing-ink-muted mt-1">{label}</dd>
    </div>
  );
}

/** The one dark "ink" brand moment on the marketing site — a fixed near-black surface (not
 * the app's light/dark toggle) with a single-claim headline, an animated word-swap instead of
 * a slide carousel (see plan rationale: none of the reference sites use carousels, and
 * auto-playing slides are a WCAG 2.2.2 burden), and an isometric-style layered panel built
 * from real CSS 3D transforms instead of a flat div-bar mock. */
export default function Hero() {
  const navigate = useNavigate();

  return (
    <MarketingSection surface="ink" glow className="py-24 lg:py-32">
      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-marketing-ink bg-white/5 px-3 py-1 text-xs font-medium text-marketing-ink-muted">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Enterprise Resource Planning,
            reimagined
          </span>
          <h1 className="mt-6 font-display font-semibold text-display-md sm:text-display-lg tracking-tight text-marketing-ink leading-[1.05]">
            Run your whole business on <RotatingClaim />
          </h1>
          <p className="mt-6 text-lg text-marketing-ink-muted max-w-xl">
            Sales, purchase, inventory, accounting, GST compliance, HR and payroll, CRM and
            production — built as one platform, not a bundle of disconnected tools.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3">
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
          <dl className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-md">
            {STATS.map((s) => (
              <StatCounter key={s.label} {...s} />
            ))}
          </dl>
        </div>

        <div className="hidden lg:block [perspective:1400px]" aria-hidden="true">
          <div className="relative h-[380px] [transform-style:preserve-3d] [transform:rotateY(-14deg)_rotateX(8deg)]">
            {[
              { Icon: Receipt, label: 'Sales', value: '₹18.4L', top: '2rem', left: '0', z: 0 },
              {
                Icon: Boxes,
                label: 'Inventory',
                value: '2,340 units',
                top: '7rem',
                left: '4rem',
                z: 40,
              },
              {
                Icon: TrendingUp,
                label: 'Growth',
                value: '+18% MoM',
                top: '12rem',
                left: '8rem',
                z: 80,
              },
            ].map(({ Icon, label, value, top, left, z }) => (
              <div
                key={label}
                className="absolute w-64 rounded-2xl border border-marketing-ink bg-white/[0.07] backdrop-blur-md shadow-2xl p-5"
                style={{ top, left, transform: `translateZ(${z}px)` }}
              >
                <div className="flex items-center gap-2 text-marketing-ink-muted text-xs font-medium uppercase tracking-wide">
                  <ModuleGlyph icon={Icon} variant="ink" size="sm" /> {label}
                </div>
                <p className="mt-2 text-2xl font-display font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-xs text-marketing-ink-muted">
            Illustrative example figures, not live data.
          </p>
        </div>
      </div>
    </MarketingSection>
  );
}
