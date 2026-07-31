import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  notificationTemplatesApi,
  type NotificationTemplate,
  type NotificationTemplateInput,
} from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

const LIST_PATH = '/settings/notification-templates';
const CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'IN_APP'] as const;
type Channel = (typeof CHANNELS)[number];

// Common template variables used across the ERP's existing system templates (see
// notification-service's seed-crm/seed-hr/seed-auth/seed-tenant routes) — a starting point, not
// an exhaustive/enforced list, since eventType is caller-defined and its variables vary per event.
const COMMON_VARS = ['{{customerName}}', '{{shopName}}', '{{orderNumber}}', '{{resetLink}}'];

export default function NotificationTemplateFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const [form, setForm] = useState({
    name: '',
    eventType: '',
    channel: 'EMAIL' as Channel,
    subject: '',
    bodyTemplate: '',
  });
  const [previewBody, setPreviewBody] = useState<string | null>(null);

  const { data: existing, isLoading } = useQuery({
    queryKey: ['notification-template', id],
    queryFn: () => notificationTemplatesApi.get(Number(id)) as Promise<NotificationTemplate>,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      eventType: existing.eventType,
      channel: existing.channel,
      subject: existing.subject ?? '',
      bodyTemplate: existing.bodyTemplate,
    });
  }, [existing]);

  const f = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const previewMut = useMutation({
    mutationFn: () =>
      notificationTemplatesApi.preview({
        bodyTemplate: form.bodyTemplate,
        ...(form.subject ? { subject: form.subject } : {}),
        sampleData: {
          customerName: 'Raj Kumar',
          shopName: 'Your Shop',
          orderNumber: 'ORD-1234',
          resetLink: 'https://example.com/reset',
        },
      }),
    onSuccess: (res) => setPreviewBody(res.renderedBody),
    onError: (err: Error) => toast.error(err.message),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: NotificationTemplateInput = {
        name: form.name,
        eventType: form.eventType,
        channel: form.channel,
        bodyTemplate: form.bodyTemplate,
        ...(form.subject ? { subject: form.subject } : {}),
      };
      return isEdit
        ? notificationTemplatesApi.update(Number(id), {
            name: form.name,
            bodyTemplate: form.bodyTemplate,
            ...(form.subject ? { subject: form.subject } : {}),
          })
        : notificationTemplatesApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Template updated' : 'Template created');
      void qc.invalidateQueries({ queryKey: ['notification-templates'] });
      navigate(LIST_PATH);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canSubmit = form.name && form.eventType && form.bodyTemplate;

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Template" backTo={LIST_PATH} />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Template' : 'New Template'}
        subtitle="Handlebars template — use {{variableName}} for placeholders."
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Template Details" columns={2}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => f('name', e.target.value)}
        />
        <Input
          label="Event Type"
          required
          disabled={isEdit}
          placeholder="e.g. INVOICE_CREATED"
          value={form.eventType}
          onChange={(e) => f('eventType', e.target.value.toUpperCase())}
        />
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">Channel</label>
          <div className="flex gap-2 flex-wrap">
            {CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                disabled={isEdit}
                onClick={() => f('channel', ch)}
                aria-pressed={form.channel === ch}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
        {form.channel === 'EMAIL' && (
          <Input
            label="Subject"
            value={form.subject}
            onChange={(e) => f('subject', e.target.value)}
          />
        )}
      </ERPFormSection>

      <ERPFormSection title="Body" columns={1}>
        <div className="mb-1.5 flex gap-1.5 flex-wrap">
          {COMMON_VARS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => f('bodyTemplate', form.bodyTemplate + v)}
              className="px-2 py-0.5 text-xs rounded bg-surface-raised border border-default text-secondary hover:text-primary"
            >
              {v}
            </button>
          ))}
        </div>
        <textarea
          value={form.bodyTemplate}
          onChange={(e) => {
            f('bodyTemplate', e.target.value);
            setPreviewBody(null);
          }}
          rows={6}
          placeholder="Hi {{customerName}}, ..."
          className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-y"
        />

        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending || !form.bodyTemplate}
          >
            {previewMut.isPending ? 'Rendering…' : 'Preview with sample data'}
          </Button>
        </div>
        {previewBody !== null && (
          <div className="mt-3 rounded-lg bg-surface-raised p-3 text-sm text-primary whitespace-pre-wrap">
            {previewBody}
          </div>
        )}
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" type="button" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          onClick={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          disabled={!canSubmit}
        >
          {isEdit ? 'Save Changes' : 'Create Template'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
