import { Webhook, Slack, Terminal, Code2 } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';

const CHANNELS = [
  { icon: Webhook, label: 'Custom webhooks' },
  { icon: Slack, label: 'Slack (via webhook)' },
  { icon: Terminal, label: 'Zapier / automation tools' },
  { icon: Code2, label: 'Your own backend' },
];

export default function IntegrationsSection() {
  return (
    <MarketingSection surface="light" className="py-24" id="integrations">
      <div className="max-w-2xl mx-auto text-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">
          Integrations
        </span>
        <h2 className="mt-3 font-display font-semibold text-display-sm text-primary">
          Connect your other tools
        </h2>
        <p className="mt-3 text-secondary">
          Subscribe any external system to key business events — invoice created, payment received,
          and more — with HMAC-signed, verifiable webhook deliveries. Configure subscriptions from
          Settings once you&apos;re signed in.
        </p>
      </div>
      <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-3xl mx-auto">
        {CHANNELS.map(({ icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-3 rounded-2xl border border-default bg-surface-card p-6 text-center"
          >
            <ModuleGlyph icon={icon} size="md" />
            <span className="text-xs font-medium text-secondary">{label}</span>
          </div>
        ))}
      </div>
    </MarketingSection>
  );
}
