import { Boxes, Layers, ShieldCheck } from 'lucide-react';
import SEO from '../../components/marketing/SEO.js';
import PublicLayout from './PublicLayout.js';
import MarketingSection from '../../components/marketing/MarketingSection.js';
import ModuleGlyph from '../../components/marketing/ModuleGlyph.js';
import CTASection from './components/CTASection.js';

const VALUES = [
  {
    icon: Layers,
    title: 'One platform, not a patchwork',
    description:
      'Every department works from the same data instead of stitched-together point solutions.',
  },
  {
    icon: Boxes,
    title: 'Built for real workflows',
    description:
      'Modules like fabric-roll tracking and job-work orders come from how businesses actually operate.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure from day one',
    description:
      'Granular RBAC, audit logging and MFA were part of the architecture from the start, not bolted on.',
  },
];

export default function AboutPage() {
  return (
    <PublicLayout>
      <SEO
        title="About"
        description="NEXORAA builds connected ERP software for growing, multi-branch businesses."
        path="/about"
      />
      <MarketingSection surface="ink" className="py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="font-display font-semibold text-display-md text-marketing-ink">
            About NEXORAA
          </h1>
          <p className="mt-4 text-marketing-ink-muted">
            We build ERP software for businesses that have outgrown spreadsheets and disconnected
            tools, but aren&apos;t ready for the complexity of legacy enterprise systems.
          </p>
        </div>
      </MarketingSection>

      <MarketingSection surface="light" className="py-20" containerClassName="max-w-3xl">
        <div className="space-y-6 text-secondary">
          <p>
            NEXORAA ERP unifies sales, purchase, inventory, accounting, GST compliance, HR and CRM
            into a single multi-tenant platform, so every department works from the same data
            instead of a patchwork of spreadsheets and point solutions.
          </p>
          <p>
            The platform is built as a set of independently-scaling services behind one consistent
            web experience, with role-based access control, audit logging and multi-factor
            authentication built in from day one.
          </p>
          <p>
            We&apos;re still early — actively shipping new modules and hardening the platform for
            enterprise scale. If you&apos;d like to be part of that journey, we&apos;d love to hear
            from you.
          </p>
        </div>

        <div className="mt-14 grid sm:grid-cols-3 gap-6">
          {VALUES.map(({ icon, title, description }) => (
            <div key={title} className="rounded-2xl border border-default bg-surface-card p-6">
              <ModuleGlyph icon={icon} size="md" />
              <h3 className="mt-4 text-sm font-semibold text-primary">{title}</h3>
              <p className="mt-1.5 text-sm text-secondary">{description}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <CTASection />
    </PublicLayout>
  );
}
