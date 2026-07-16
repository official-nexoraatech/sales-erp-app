import { ShieldCheck, KeyRound, FileClock, Lock } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

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
        {REAL_CAPABILITIES.map(({ icon, title, description }) => (
          <div
            key={title}
            className="flex gap-3 rounded-2xl border border-default bg-surface-page p-5"
          >
            <ModuleGlyph icon={icon} size="sm" />
            <div>
              <h3 className="text-sm font-semibold text-primary">{title}</h3>
              <p className="text-sm text-secondary mt-0.5">{description}</p>
            </div>
          </div>
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
              <span className="text-warning">&middot; In Progress</span>
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
