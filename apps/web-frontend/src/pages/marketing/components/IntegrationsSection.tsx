import { Webhook, Slack, Terminal, Code2 } from 'lucide-react';
import ModuleGlyph from '../../../components/marketing/ModuleGlyph.js';
import MarketingSection from '../../../components/marketing/MarketingSection.js';
import { useScrollReveal } from '../../../hooks/useScrollReveal.js';

const CHANNELS = [
  {
    icon: Webhook,
    label: 'Custom webhooks',
    description: 'HMAC-signed deliveries to any endpoint you configure.',
  },
  {
    icon: Slack,
    label: 'Slack (via webhook)',
    description: 'Post key events straight into a team channel.',
  },
  {
    icon: Terminal,
    label: 'Zapier / automation tools',
    description: 'Wire events into no-code automation platforms.',
  },
  {
    icon: Code2,
    label: 'Your own backend',
    description: 'Verify signatures and handle events however you need.',
  },
];

function ChannelCard({
  icon,
  label,
  description,
  index,
}: (typeof CHANNELS)[number] & { index: number }) {
  const { ref, isVisible } = useScrollReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: isVisible ? `${Math.min(index, 6) * 60}ms` : '0ms' }}
      className={`flex flex-col items-center gap-3 rounded-2xl border border-default bg-surface-card p-6 text-center shadow-token-sm transition-all duration-slow hover:-translate-y-1 hover:border-brand hover:shadow-token-lg ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      }`}
    >
      <ModuleGlyph icon={icon} size="md" />
      <div>
        <span className="text-sm font-medium text-primary">{label}</span>
        <p className="mt-1 text-xs text-secondary">{description}</p>
      </div>
    </div>
  );
}

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
      <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-4xl mx-auto">
        {CHANNELS.map((channel, index) => (
          <ChannelCard key={channel.label} {...channel} index={index} />
        ))}
      </div>
    </MarketingSection>
  );
}
