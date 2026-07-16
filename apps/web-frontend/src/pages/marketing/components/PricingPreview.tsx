import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import Button from '../../../components/ui/Button.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

// Mirrors packages/db-client/migrations/0040_pg027_billing_entitlements.sql's real
// plan_entitlements seed data exactly (max_users/max_branches/feature_flags) — no invented
// limits. Prices are intentionally omitted: monthly_price_paise is NULL for every plan in
// that table (pricing isn't set by the business yet), so every plan routes to a real CTA
// (self-serve signup for Starter, sales conversation for Growth/Enterprise — there is
// currently no self-service plan-upgrade path in the product, so that's accurate too).
export const PLANS = [
  {
    id: 'STARTER',
    name: 'Starter',
    description: 'For small teams getting off spreadsheets.',
    limits: ['5 users', '1 branch'],
    features: [
      'Sales, purchase & inventory',
      'Core accounting reports',
      'Quotations & credit-limit checks',
      'Email & SMS notifications',
    ],
    cta: 'Start Free Trial',
    highlighted: false,
  },
  {
    id: 'GROWTH',
    name: 'Growth',
    description: 'For growing, multi-branch operations.',
    limits: ['25 users', '5 branches'],
    features: [
      'Everything in Starter',
      'Multi-branch operations',
      'GST e-Invoice & e-Way Bill generation',
      'Point of Sale (POS)',
      'CRM & campaign automation',
    ],
    cta: 'Talk to Sales',
    highlighted: true,
  },
  {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'For large, complex organizations.',
    limits: ['Unlimited users', 'Unlimited branches'],
    features: [
      'Everything in Growth',
      'HR & payroll, attendance tracking',
      'WhatsApp notifications',
      'Advanced RBAC, audit logs & impersonation',
      'Signed webhook integrations',
    ],
    cta: 'Talk to Sales',
    highlighted: false,
  },
];

export default function PricingPreview() {
  const navigate = useNavigate();
  return (
    <MarketingSection surface="light" className="py-24" id="pricing-preview">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">Pricing</span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          Choose your plan
        </h2>
        <p className="mt-3 text-secondary">Start free on Starter. Talk to us when you need more.</p>
      </div>
      <div className="mt-14 grid md:grid-cols-3 gap-6 items-start">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-2xl border p-8 ${
              plan.highlighted
                ? 'border-brand shadow-token-lg bg-surface-card relative'
                : 'border-default bg-surface-card'
            }`}
          >
            {plan.highlighted && (
              <span className="absolute -top-3 left-8 rounded-full bg-brand text-primary-fg text-xs font-semibold px-3 py-1">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-bold text-primary">{plan.name}</h3>
            <p className="mt-1 text-sm text-secondary">{plan.description}</p>
            <div className="mt-4 flex gap-2">
              {plan.limits.map((l) => (
                <span
                  key={l}
                  className="text-xs font-medium rounded-full bg-surface-subtle px-2.5 py-1 text-secondary"
                >
                  {l}
                </span>
              ))}
            </div>
            <ul className="mt-6 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-primary">
                  <Check className="h-4 w-4 text-success shrink-0 mt-0.5" />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              className="w-full justify-center mt-8"
              variant={plan.highlighted ? 'primary' : 'secondary'}
              onClick={() => navigate(plan.cta === 'Talk to Sales' ? '/contact' : '/signup')}
            >
              {plan.cta}
            </Button>
          </div>
        ))}
      </div>
    </MarketingSection>
  );
}
