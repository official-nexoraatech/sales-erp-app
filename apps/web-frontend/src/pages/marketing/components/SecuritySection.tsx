import { ShieldCheck, KeyRound, FileClock, Lock, Clock } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';

const REAL_CAPABILITIES = [
  {
    icon: KeyRound,
    title: 'Role-based access control',
    description: 'Granular, per-permission RBAC across every module — not just admin vs. user.',
  },
  {
    icon: ShieldCheck,
    title: 'Multi-factor authentication',
    description: 'TOTP-based 2FA with backup codes for every account.',
  },
  {
    icon: FileClock,
    title: 'Full audit trails',
    description:
      'Every sensitive action — including support-team impersonation — is logged and reviewable by tenant administrators.',
  },
  {
    icon: Lock,
    title: 'Encrypted in transit',
    description:
      'All traffic is served over HTTPS/TLS; sensitive configuration secrets are encrypted at rest.',
  },
];

const ROADMAP_BADGES = ['ISO 27001', 'SOC 2', 'GDPR', 'HIPAA'];

function CapabilityCard({
  icon,
  title,
  description,
  index,
}: (typeof REAL_CAPABILITIES)[number] & { index: number }) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: isVisible ? `${Math.min(index, 6) * 60}ms` : '0ms' }}
      className={`flex gap-3 rounded-2xl border border-default bg-surface-page p-5 shadow-token-sm transition-all duration-slow hover:-translate-y-1 hover:border-brand hover:shadow-token-lg ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <ModuleGlyph icon={icon} size="sm" />
      <div>
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <p className="text-sm text-secondary mt-0.5">{description}</p>
      </div>
    </div>
  );
}

export default function SecuritySection() {
  return (
    <MarketingSection surface="card" className="py-24" id="security">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">Security</span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          Security & compliance
        </h2>
        <p className="mt-3 text-secondary">
          Built with enterprise security fundamentals from day one.
        </p>
      </div>

      <div className="mt-14 grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
        {REAL_CAPABILITIES.map((capability, index) => (
          <CapabilityCard key={capability.title} {...capability} index={index} />
        ))}
      </div>

      <div className="mt-14 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-secondary mb-4">
          Compliance roadmap
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {ROADMAP_BADGES.map((badge) => (
            <span
              key={badge}
              className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface-page px-3 py-1.5 text-xs font-medium text-secondary"
            >
              {badge}
              <span className="inline-flex items-center gap-1 text-warning">
                <Clock className="h-3 w-3" /> In Progress
              </span>
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-secondary max-w-md mx-auto">
          These certifications are on our roadmap and not yet obtained — shown here for transparency
          about our compliance direction, not as a claim of current certification.
        </p>
      </div>
    </MarketingSection>
  );
}
