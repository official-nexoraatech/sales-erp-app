import { Lock, Layers, Cloud, Building2, Workflow, Smartphone } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

const REASONS = [
  {
    icon: Lock,
    title: 'Secure by design',
    description:
      '285 granular permissions, role-based access control, MFA, and a full audit trail on every sensitive action — not a single "admin vs. user" toggle.',
    featured: true,
  },
  {
    icon: Layers,
    title: 'Multi-tenant, multi-branch',
    description: 'One deployment serves every tenant and branch, with strict data isolation.',
  },
  {
    icon: Cloud,
    title: 'Cloud-native architecture',
    description: 'Independently scaling microservices, not a single monolith holding you back.',
  },
  {
    icon: Building2,
    title: 'Enterprise-grade',
    description: 'Built for the real workflows of growing, multi-location businesses.',
  },
  {
    icon: Workflow,
    title: 'Workflow automation',
    description: '20 built-in approval workflows and signed outbound webhooks that run themselves.',
  },
  {
    icon: Smartphone,
    title: 'Works everywhere',
    description: 'A responsive web app plus a dedicated point-of-sale experience.',
  },
];

export default function WhyChooseUs() {
  return (
    <MarketingSection surface="card" className="py-24">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">
          Why NEXORAA
        </span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          Built for teams who've outgrown spreadsheets
        </h2>
      </div>
      <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2 gap-5">
        {REASONS.map(({ icon, title, description, featured }) => (
          <div
            key={title}
            className={`rounded-2xl border border-default bg-surface-page p-6 flex flex-col ${
              featured ? 'lg:col-span-2 lg:row-span-2 justify-center' : 'justify-start'
            }`}
          >
            <ModuleGlyph icon={icon} size={featured ? 'lg' : 'md'} variant="accent" />
            <h3 className={`mt-4 font-semibold text-primary ${featured ? 'text-xl' : 'text-sm'}`}>
              {title}
            </h3>
            <p className={`mt-1.5 text-secondary ${featured ? 'text-base' : 'text-sm'}`}>
              {description}
            </p>
          </div>
        ))}
      </div>
    </MarketingSection>
  );
}
