import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowRight } from 'lucide-react';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Input from '../../components/ui/Input.js';

interface CommunicationSettings {
  approvalRequired: boolean;
  maxPerDayFrequencyCap: number | null;
  notificationRateLimitPerMinute: number | null;
}

const PLATFORM_DEFAULT_RATE_LIMIT = 200;

interface SenderIdentity {
  id: number;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  senderName: string;
  senderAddressOrNumber: string;
}

const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'] as const;

function ApprovalSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['crm-communication-settings'],
    queryFn: () => crmApi.getCommunicationSettings(),
  });
  const settings = data as CommunicationSettings | undefined;

  const [approvalRequired, setApprovalRequired] = useState(false);
  const [frequencyCap, setFrequencyCap] = useState('');
  const [rateLimit, setRateLimit] = useState('');

  useEffect(() => {
    if (!settings) return;
    setApprovalRequired(settings.approvalRequired);
    setFrequencyCap(
      settings.maxPerDayFrequencyCap != null ? String(settings.maxPerDayFrequencyCap) : ''
    );
    setRateLimit(
      settings.notificationRateLimitPerMinute != null
        ? String(settings.notificationRateLimitPerMinute)
        : ''
    );
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: () =>
      crmApi.updateCommunicationSettings({
        approvalRequired,
        maxPerDayFrequencyCap: frequencyCap ? Number(frequencyCap) : null,
        notificationRateLimitPerMinute: rateLimit ? Number(rateLimit) : null,
      }),
    onSuccess: () => toast.success('Campaign settings saved'),
    onError: () => toast.error('Failed to save campaign settings'),
  });

  if (isLoading) return <ERPFormSkeleton />;

  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-6">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Approval &amp; Frequency
      </h2>
      <div>
        <Checkbox
          checked={approvalRequired}
          onChange={(e) => setApprovalRequired(e.target.checked)}
          label="Require approval before a campaign can be scheduled or sent"
          description="When enabled, a campaign must move through Submit for Approval → Approved by someone holding the Approve Campaigns permission before it can be scheduled or sent. When disabled (the default), Submit for Approval auto-approves immediately."
        />
      </div>
      <div>
        <Input
          label="Maximum messages per customer per day (optional)"
          type="number"
          min={1}
          value={frequencyCap}
          onChange={(e) => setFrequencyCap(e.target.value)}
          placeholder="No limit"
        />
        <p className="text-xs text-secondary mt-1.5">
          Applies across every campaign combined — a customer who already received this many
          messages today from any campaign is skipped, not just capped per-campaign. Leave blank for
          no limit.
        </p>
      </div>
      <div>
        <Input
          label={`Notification send rate limit, per minute (optional — platform default is ${PLATFORM_DEFAULT_RATE_LIMIT}/minute)`}
          type="number"
          min={1}
          value={rateLimit}
          onChange={(e) => setRateLimit(e.target.value)}
          placeholder={`Default (${PLATFORM_DEFAULT_RATE_LIMIT}/minute)`}
        />
        <p className="text-xs text-secondary mt-1.5">
          Caps how many recipients this tenant's campaigns can send to per minute. Every tenant
          shares this cap independently — one tenant's large campaign can never affect another
          tenant's send throughput. Raise this for a tenant that regularly sends to more than{' '}
          {PLATFORM_DEFAULT_RATE_LIMIT} recipients in a single campaign; recipients beyond the limit
          are marked failed with a clear "rate limit exceeded" reason and are not retried
          automatically yet.
        </p>
      </div>
      <div className="flex justify-end pt-2">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          {saveMut.isPending ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}

function SenderIdentitySection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['crm-sender-identity'],
    queryFn: () => crmApi.listSenderIdentities(),
  });
  const identities: SenderIdentity[] = (data as { content?: SenderIdentity[] })?.content ?? [];

  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('EMAIL');
  const [senderName, setSenderName] = useState('');
  const [senderAddressOrNumber, setSenderAddressOrNumber] = useState('');

  function editExisting(identity: SenderIdentity): void {
    setChannel(identity.channel);
    setSenderName(identity.senderName);
    setSenderAddressOrNumber(identity.senderAddressOrNumber);
  }

  const saveMut = useMutation({
    mutationFn: () => crmApi.saveSenderIdentity({ channel, senderName, senderAddressOrNumber }),
    onSuccess: () => {
      toast.success(`${channel} sender identity saved`);
      void qc.invalidateQueries({ queryKey: ['crm-sender-identity'] });
      setSenderName('');
      setSenderAddressOrNumber('');
    },
    onError: () => toast.error('Failed to save sender identity'),
  });

  if (isLoading) return <ERPFormSkeleton />;

  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Sender Identity
      </h2>
      <p className="text-xs text-secondary">
        Configure a custom "from" name/address per channel. Only Email delivery actually uses this
        today — SMS and WhatsApp sender identity requires provider-side business registration (MSG91
        sender ID, Meta WhatsApp Business number) that can't be changed by a setting alone, so those
        are saved for reference but not yet applied to outbound sends.
      </p>

      {identities.length > 0 && (
        <div className="divide-y divide-default border border-default rounded-lg">
          {identities.map((i) => (
            <div key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{i.channel}</span>
                <span className="text-secondary">
                  {' '}
                  — {i.senderName} ({i.senderAddressOrNumber})
                </span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => editExisting(i)}>
                Edit
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}
            aria-label="Channel"
            className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Sender Name"
          value={senderName}
          onChange={(e) => setSenderName(e.target.value)}
          placeholder="Style Hub"
        />
        <Input
          label="Sender Address / Number"
          value={senderAddressOrNumber}
          onChange={(e) => setSenderAddressOrNumber(e.target.value)}
          placeholder="promo@stylehub.example"
        />
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !senderName.trim() || !senderAddressOrNumber.trim()}
        >
          {saveMut.isPending ? 'Saving…' : 'Save Sender Identity'}
        </Button>
      </div>
    </div>
  );
}

function WebhooksMovedNotice() {
  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-2">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Outbound Webhooks
      </h2>
      <p className="text-sm text-secondary">
        Webhook subscriptions now cover any business event, not just campaigns, and have moved to{' '}
        <Link
          to="/settings/integrations"
          className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
        >
          Organization → Integrations
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        .
      </p>
    </div>
  );
}

export default function CampaignSettingsPage() {
  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Campaign Settings"
        subtitle="Tenant-wide rules and integrations applied to every campaign"
      />
      <div className="space-y-5 max-w-3xl">
        <ApprovalSection />
        <SenderIdentitySection />
        <WebhooksMovedNotice />
      </div>
    </div>
  );
}
