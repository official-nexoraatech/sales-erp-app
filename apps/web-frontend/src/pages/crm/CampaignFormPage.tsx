import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import DateTimePicker from '../../components/ui/DateTimePicker.js';

interface Segment {
  id: number;
  name: string;
  code: string;
  isSystem: boolean;
}
interface CampaignTemplate {
  id: number;
  name: string;
  channel: string;
  campaignType: string | null;
  messageTemplate: string;
}
interface Attachment {
  id: number;
  fileName: string;
  mimeType: string;
}

const CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP'] as const;
type Channel = (typeof CHANNELS)[number];

const SMS_LIMIT = 160;
const SMS_UNICODE_LIMIT = 70;

function charWarnings(channel: Channel, message: string): string[] {
  const warnings: string[] = [];
  if (channel === 'SMS') {
    if (message.length > SMS_LIMIT)
      warnings.push(
        `SMS exceeds ${SMS_LIMIT} chars — may split into ${Math.ceil(message.length / SMS_LIMIT)} messages`
      );
    // eslint-disable-next-line no-control-regex
    else if (message.length > SMS_UNICODE_LIMIT && /[^\x00-\x7F]/.test(message))
      warnings.push(`Unicode SMS truncates at ${SMS_UNICODE_LIMIT} chars`);
  }
  return warnings;
}

const TEMPLATE_VARS = [
  '{{customerName}}',
  '{{balance}}',
  '{{loyaltyPoints}}',
  '{{shopName}}',
  '{{lastPurchaseDate}}',
  '{{lastPurchaseAmount}}',
];

// CP-4 (Campaign Management Platform initiative): default Clothing-vertical campaign type
// taxonomy (FR-A1) — tenant-configurable metadata, not an enum, so adding a type later never
// needs a schema change. Abandoned Cart / automation-only types are deliberately excluded here
// since they only make sense as automation triggers (CP-5), not a manually-authored campaign.
const CAMPAIGN_TYPES = [
  'Promotional',
  'Loyalty',
  'Coupon',
  'Birthday',
  'Anniversary',
  'Seasonal',
  'Festival',
  'Clearance',
  'Flash Sale',
  'New Arrivals',
  'Product Launch',
  'Win-Back',
  'Reactivation',
  'Feedback / Survey',
  'Referral',
  'Event Invitation',
  'Membership',
  'VIP',
  'Educational',
  'Announcement',
];

export default function CampaignFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const campaignId = id ? Number(id) : undefined;
  const isEdit = campaignId !== undefined;

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [form, setForm] = useState({
    name: '',
    channel: 'WHATSAPP' as Channel,
    messageTemplate: '',
    segmentId: '',
    scheduledAt: '',
    campaignType: '',
  });
  const [version, setVersion] = useState<number | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewMsg, setPreviewMsg] = useState('');
  const [previewFallbacks, setPreviewFallbacks] = useState<string[]>([]);

  const { data: segData, isLoading: segmentsLoading } = useQuery({
    queryKey: ['crm-segments'],
    queryFn: () => crmApi.listSegments(),
    enabled: hasPermission(PERMISSIONS.CRM_SEGMENT_VIEW),
  });
  const segments: Segment[] = (segData as { content?: Segment[] })?.content ?? [];

  const { data: templateData } = useQuery({
    queryKey: ['crm-campaign-templates', form.channel],
    queryFn: () => crmApi.listCampaignTemplates({ channel: form.channel }),
  });
  const templates: CampaignTemplate[] =
    (templateData as { content?: CampaignTemplate[] })?.content ?? [];

  const { data: existingCampaign, isLoading: campaignLoading } = useQuery({
    queryKey: ['crm-campaign', campaignId],
    queryFn: () => crmApi.getCampaign(campaignId as number),
    enabled: isEdit,
  });

  const { data: mediaData, refetch: refetchMedia } = useQuery({
    queryKey: ['crm-campaign-media', campaignId],
    queryFn: () => crmApi.listCampaignMedia(campaignId as number),
    enabled: isEdit,
  });
  const media: Attachment[] = (mediaData as { data?: Attachment[] })?.data ?? [];

  useEffect(() => {
    if (!existingCampaign) return;
    const c = existingCampaign as Record<string, unknown>;
    setForm({
      name: (c.name as string) ?? '',
      channel: (c.channel as Channel) ?? 'WHATSAPP',
      messageTemplate: (c.messageTemplate as string) ?? '',
      segmentId: c.segmentId ? String(c.segmentId) : '',
      scheduledAt: '',
      campaignType: (c.campaignType as string) ?? '',
    });
    setVersion((c.version as number) ?? 0);
  }, [existingCampaign]);

  const warnings = charWarnings(form.channel, form.messageTemplate);

  const previewMut = useMutation({
    mutationFn: () =>
      crmApi.previewCampaign({
        segmentId: form.segmentId ? Number(form.segmentId) : undefined,
        messageTemplate: form.messageTemplate,
        channel: form.channel,
      }),
    onSuccess: (res) => {
      const d = res as Record<string, unknown>;
      setPreviewCount((d?.recipientCount as number) ?? 0);
      setPreviewMsg((d?.sampleMessage as string) ?? '');
      setPreviewFallbacks((d?.fallbackWarnings as string[]) ?? []);
    },
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const created = (await crmApi.createCampaign({
        name: form.name,
        channel: form.channel,
        messageTemplate: form.messageTemplate,
        segmentId: form.segmentId ? Number(form.segmentId) : undefined,
        campaignType: form.campaignType || undefined,
        templateId: templateId ? Number(templateId) : undefined,
      })) as { id?: number };
      if (form.scheduledAt && created?.id) {
        await crmApi.scheduleCampaign(created.id, {
          scheduledAt: new Date(form.scheduledAt).toISOString(),
        });
      }
      return created;
    },
    onSuccess: () => {
      toast.success(form.scheduledAt ? 'Campaign created and scheduled' : 'Campaign created');
      navigate('/crm/campaigns');
    },
    onError: () => toast.error('Failed to create campaign'),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      crmApi.updateCampaign(campaignId as number, {
        version,
        name: form.name,
        channel: form.channel,
        messageTemplate: form.messageTemplate,
        segmentId: form.segmentId ? Number(form.segmentId) : null,
        campaignType: form.campaignType || null,
      }),
    onSuccess: () => {
      toast.success('Campaign updated');
      qc.invalidateQueries({ queryKey: ['crm-campaigns'] });
      navigate('/crm/campaigns');
    },
    onError: () =>
      toast.error('Failed to update campaign — it may have changed since you loaded it'),
  });

  const uploadMediaMut = useMutation({
    mutationFn: (file: File) => crmApi.uploadCampaignMedia(campaignId as number, file),
    onSuccess: () => {
      toast.success('Media attached');
      refetchMedia();
    },
    onError: (err: unknown) => {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Failed to attach media';
      toast.error(message);
    },
  });

  const deleteMediaMut = useMutation({
    mutationFn: (attachmentId: number) => crmApi.deleteAttachment(attachmentId),
    onSuccess: () => refetchMedia(),
  });

  useEffect(() => {
    setPreviewCount(null);
    setPreviewMsg('');
    setPreviewFallbacks([]);
  }, [form.segmentId, form.messageTemplate]);

  const f = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const tpl = templates.find((t) => String(t.id) === id);
    if (tpl) {
      setForm((prev) => ({
        ...prev,
        messageTemplate: tpl.messageTemplate,
        campaignType: tpl.campaignType ?? prev.campaignType,
      }));
    }
  };

  const canSubmit = form.name && form.channel && form.messageTemplate && form.segmentId;
  const isSaving = createMut.isPending || updateMut.isPending;

  if (segmentsLoading || (isEdit && campaignLoading)) {
    return (
      <div>
        <ERPPageHeader
          variant="detail"
          title={isEdit ? 'Edit Campaign' : 'New Campaign'}
          subtitle="Configure and launch a customer campaign"
          backTo="/crm/campaigns"
        />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Campaign' : 'New Campaign'}
        subtitle="Configure and launch a customer campaign"
        backTo="/crm/campaigns"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main form */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-surface-card rounded-xl border border-default p-5 space-y-4">
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
              Campaign Details
            </h2>

            <Input
              label="Campaign Name"
              value={form.name}
              onChange={(e) => f('name', e.target.value)}
              placeholder="e.g. Diwali Sale 2025"
            />

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
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Target Segment
              </label>
              <select
                value={form.segmentId}
                onChange={(e) => f('segmentId', e.target.value)}
                className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                <option value="">— Select a segment —</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-secondary mb-1.5">
                  Campaign Type (optional)
                </label>
                <select
                  value={form.campaignType}
                  onChange={(e) => f('campaignType', e.target.value)}
                  className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
                >
                  <option value="">— None —</option>
                  {CAMPAIGN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {!isEdit && (
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">
                    Load from Template (optional)
                  </label>
                  <select
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
                  >
                    <option value="">— None —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Message Template
              </label>
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
                <span className="text-xs text-secondary">
                  {form.messageTemplate.length} characters
                </span>
                {warnings.map((w) => (
                  <span key={w} className="text-xs text-warning font-medium">
                    {w}
                  </span>
                ))}
              </div>
            </div>

            {!isEdit && (
              <div>
                <DateTimePicker
                  label="Schedule (optional — leave blank to send manually)"
                  value={form.scheduledAt}
                  onChange={(v) => f('scheduledAt', v)}
                />
              </div>
            )}
          </div>

          {isEdit && (
            <div className="bg-surface-card rounded-xl border border-default p-5 space-y-3">
              <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
                Media Attachment
              </h2>
              <p className="text-xs text-secondary">
                {form.channel === 'EMAIL' || form.channel === 'WHATSAPP'
                  ? 'Attach one image, video, or document to include with this campaign.'
                  : `${form.channel} campaigns cannot include media.`}
              </p>
              {media.length > 0 && (
                <ul className="space-y-1">
                  {media.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between text-sm bg-surface-raised rounded-lg px-3 py-2"
                    >
                      <span className="truncate">{m.fileName}</span>
                      <Button variant="ghost" onClick={() => deleteMediaMut.mutate(m.id)}>
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {media.length === 0 && (form.channel === 'EMAIL' || form.channel === 'WHATSAPP') && (
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadMediaMut.mutate(file);
                  }}
                  className="text-sm text-secondary"
                />
              )}
            </div>
          )}
        </div>

        {/* Preview panel */}
        <div className="space-y-4">
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">
              Preview
            </h2>
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
                    <div className="rounded-lg bg-surface-raised p-3 text-sm text-primary whitespace-pre-wrap">
                      {previewMsg}
                    </div>
                  </div>
                )}
                {previewFallbacks.length > 0 && (
                  <div className="rounded-lg bg-warning/10 border border-warning/30 p-3">
                    <p className="text-xs font-semibold text-warning mb-1">
                      Missing data for this recipient
                    </p>
                    <p className="text-xs text-secondary">
                      {previewFallbacks.join(', ')} will show a placeholder value for recipients
                      without this data.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-surface-card rounded-xl border border-default p-4">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
              Template Variables
            </p>
            <ul className="space-y-1">
              {[
                ['{{customerName}}', 'Customer display name'],
                ['{{balance}}', 'Account balance'],
                ['{{loyaltyPoints}}', 'Loyalty points balance'],
                ['{{shopName}}', 'Your shop name'],
                ['{{lastPurchaseDate}}', "Customer's last purchase date"],
                ['{{lastPurchaseAmount}}', "Customer's last purchase amount"],
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

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate('/crm/campaigns')}>
          Cancel
        </Button>
        <Button
          onClick={() => (isEdit ? updateMut.mutate() : createMut.mutate())}
          disabled={isSaving || !canSubmit}
        >
          {isSaving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Campaign'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
