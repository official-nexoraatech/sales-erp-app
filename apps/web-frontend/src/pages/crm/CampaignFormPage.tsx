import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';

interface Segment { id: number; name: string; code: string; isSystem: boolean; }

const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'] as const;
type Channel = (typeof CHANNELS)[number];

const SMS_LIMIT = 160;
const SMS_UNICODE_LIMIT = 70;

function charWarnings(channel: Channel, message: string): string[] {
  const warnings: string[] = [];
  if (channel === 'SMS') {
    if (message.length > SMS_LIMIT) warnings.push(`SMS exceeds ${SMS_LIMIT} chars — may split into ${Math.ceil(message.length / SMS_LIMIT)} messages`);
    else if (message.length > SMS_UNICODE_LIMIT && /[^\x00-\x7F]/.test(message)) warnings.push(`Unicode SMS truncates at ${SMS_UNICODE_LIMIT} chars`);
  }
  return warnings;
}

const TEMPLATE_VARS = ['{{customerName}}', '{{balance}}', '{{loyaltyPoints}}', '{{shopName}}'];

export default function CampaignFormPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    channel: 'WHATSAPP' as Channel,
    messageTemplate: '',
    segmentId: '',
    scheduledAt: '',
  });
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewMsg, setPreviewMsg] = useState('');

  const { data: segData } = useQuery({ queryKey: ['crm-segments'], queryFn: () => crmApi.listSegments() });
  const segments: Segment[] = (segData as Record<string, unknown>)?.data as Segment[] ?? [];

  const warnings = charWarnings(form.channel, form.messageTemplate);

  const previewMut = useMutation({
    mutationFn: () =>
      crmApi.previewSegment({
        segmentId: form.segmentId ? Number(form.segmentId) : undefined,
        messageTemplate: form.messageTemplate,
      }),
    onSuccess: (res) => {
      const d = (res as Record<string, unknown>)?.data as Record<string, unknown>;
      setPreviewCount(d?.recipientCount as number ?? 0);
      setPreviewMsg(d?.sampleMessage as string ?? '');
    },
  });

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createCampaign({
        name: form.name,
        channel: form.channel,
        messageTemplate: form.messageTemplate,
        segmentId: form.segmentId ? Number(form.segmentId) : undefined,
        scheduledAt: form.scheduledAt || undefined,
      }),
    onSuccess: () => {
      toast.success('Campaign created');
      navigate('/crm/campaigns');
    },
    onError: () => toast.error('Failed to create campaign'),
  });

  useEffect(() => {
    setPreviewCount(null);
    setPreviewMsg('');
  }, [form.segmentId, form.messageTemplate]);

  const f = <K extends keyof typeof form>(key: K, val: typeof form[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const canSubmit = form.name && form.channel && form.messageTemplate && form.segmentId;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="New Campaign"
        subtitle="Configure and launch a customer campaign"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate('/crm/campaigns')}>Cancel</Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !canSubmit}
            >
              {createMut.isPending ? 'Creating…' : 'Create Campaign'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">Campaign Details</h2>

            <Input label="Campaign Name" value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="e.g. Diwali Sale 2025" />

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Channel</label>
              <div className="flex gap-2 flex-wrap">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch}
                    onClick={() => f('channel', ch)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      form.channel === ch
                        ? 'bg-primary text-white border-primary'
                        : 'border-default text-secondary hover:bg-surface-raised'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Target Segment</label>
              <select
                value={form.segmentId}
                onChange={(e) => f('segmentId', e.target.value)}
                className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                <option value="">— Select a segment —</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Message Template</label>
              <div className="mb-1.5 flex gap-1.5 flex-wrap">
                {TEMPLATE_VARS.map((v) => (
                  <button
                    key={v}
                    onClick={() => f('messageTemplate', form.messageTemplate + v)}
                    className="px-2 py-0.5 text-xs rounded bg-surface-raised border border-default text-secondary hover:text-primary"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <textarea
                value={form.messageTemplate}
                onChange={(e) => f('messageTemplate', e.target.value)}
                rows={5}
                placeholder="Hi {{customerName}}, visit us for exclusive offers…"
                className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-y"
              />
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-secondary">{form.messageTemplate.length} characters</span>
                {warnings.map((w) => (
                  <span key={w} className="text-xs text-warning font-medium">{w}</span>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Schedule (optional — leave blank to send manually)</label>
              <Input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => f('scheduledAt', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Preview panel */}
        <div className="space-y-4">
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">Preview</h2>
            <Button
              variant="secondary"
              onClick={() => previewMut.mutate()}
              disabled={previewMut.isPending || !form.segmentId || !form.messageTemplate}
              className="w-full mb-4"
            >
              {previewMut.isPending ? 'Loading…' : 'Preview Recipients'}
            </Button>
            {previewCount !== null && (
              <div className="space-y-3">
                <div className="rounded-lg bg-surface-raised p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{previewCount}</p>
                  <p className="text-xs text-secondary mt-0.5">matched recipients</p>
                </div>
                {previewMsg && (
                  <div>
                    <p className="text-xs font-medium text-secondary mb-1.5">Sample message</p>
                    <div className="rounded-lg bg-surface-raised p-3 text-sm text-primary whitespace-pre-wrap">{previewMsg}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-surface-card rounded-xl border border-default p-4">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">Template Variables</p>
            <ul className="space-y-1">
              {[
                ['{{customerName}}', 'Customer display name'],
                ['{{balance}}', 'Account balance'],
                ['{{loyaltyPoints}}', 'Loyalty points balance'],
                ['{{shopName}}', 'Your shop name'],
              ].map(([v, d]) => (
                <li key={v} className="flex items-start gap-2 text-xs">
                  <code className="font-mono text-brand">{v}</code>
                  <span className="text-secondary">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
