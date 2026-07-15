import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Input from '../../components/ui/Input.js';
import Modal from '../../components/ui/Modal.js';

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

interface WebhookSubscription {
  id: number;
  targetUrl: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'] as const;
const WEBHOOK_EVENTS = ['CAMPAIGN_SENT', 'CAMPAIGN_CANCELLED'] as const;

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

function WebhookSubscriptionsSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ['crm-webhook-subscriptions'],
    queryFn: () => crmApi.listWebhookSubscriptions(),
  });
  const subscriptions: WebhookSubscription[] =
    (data as { content?: WebhookSubscription[] })?.content ?? [];

  const [targetUrl, setTargetUrl] = useState('');
  const [events, setEvents] = useState<string[]>([...WEBHOOK_EVENTS]);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => crmApi.createWebhookSubscription({ targetUrl, events }),
    onSuccess: (res) => {
      const created = res as { secret?: string };
      toast.success('Webhook subscription created');
      void qc.invalidateQueries({ queryKey: ['crm-webhook-subscriptions'] });
      setTargetUrl('');
      if (created.secret) setNewSecret(created.secret);
    },
    onError: () => toast.error('Failed to create webhook subscription'),
  });

  const toggleActiveMut = useMutation({
    mutationFn: (sub: WebhookSubscription) =>
      crmApi.updateWebhookSubscription(sub.id, { isActive: !sub.isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['crm-webhook-subscriptions'] }),
    onError: () => toast.error('Failed to update webhook subscription'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => crmApi.deleteWebhookSubscription(id),
    onSuccess: () => {
      toast.success('Webhook subscription removed');
      void qc.invalidateQueries({ queryKey: ['crm-webhook-subscriptions'] });
    },
    onError: () => toast.error('Failed to remove webhook subscription'),
  });

  if (isLoading) return <ERPFormSkeleton />;

  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Outbound Webhooks
      </h2>
      <p className="text-xs text-secondary">
        Notify a third-party CRM/marketing tool automatically when a campaign is sent or cancelled.
        Each call is HMAC-SHA256 signed with the subscription's secret (shown once, at creation).
      </p>

      {subscriptions.length > 0 && (
        <div className="divide-y divide-default border border-default rounded-lg">
          {subscriptions.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 text-sm gap-3">
              <div className="min-w-0">
                <p className="truncate">{s.targetUrl}</p>
                <p className="text-xs text-secondary">
                  {s.events.join(', ')} — {s.isActive ? 'Active' : 'Paused'}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => toggleActiveMut.mutate(s)}>
                  {s.isActive ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Remove Webhook Subscription',
                      message: `Stop notifying ${s.targetUrl}?`,
                      confirmLabel: 'Remove',
                      variant: 'danger',
                    });
                    if (ok) deleteMut.mutate(s.id);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <Input
          label="Target URL"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://your-crm.example.com/webhooks/erp"
        />
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">Events</label>
          <div className="flex gap-4">
            {WEBHOOK_EVENTS.map((ev) => (
              <Checkbox
                key={ev}
                checked={events.includes(ev)}
                onChange={(e) =>
                  setEvents((prev) =>
                    e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)
                  )
                }
                label={ev.replace('_', ' ')}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !targetUrl.trim() || events.length === 0}
          >
            {createMut.isPending ? 'Creating…' : 'Add Subscription'}
          </Button>
        </div>
      </div>

      <Modal open={newSecret !== null} onClose={() => setNewSecret(null)} title="Webhook Secret">
        <div className="space-y-3">
          <p className="text-sm text-secondary">
            Save this secret now — it's shown only once and can't be retrieved later. Use it to
            verify the <code>X-Webhook-Signature</code> header (HMAC-SHA256) on incoming calls.
          </p>
          <code className="block break-all rounded-lg bg-surface-raised p-3 text-xs">
            {newSecret}
          </code>
          <div className="flex justify-end">
            <Button onClick={() => setNewSecret(null)}>Done</Button>
          </div>
        </div>
      </Modal>
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
        <WebhookSubscriptionsSection />
      </div>
    </div>
  );
}
