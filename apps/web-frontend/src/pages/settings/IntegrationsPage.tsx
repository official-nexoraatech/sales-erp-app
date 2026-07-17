import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Copy, Pencil } from 'lucide-react';
import { integrationApi, type WebhookSubscription } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPStatusBadge from '../../components/erp/ERPStatusBadge.js';
import ERPDrawer from '../../components/erp/ERPDrawer.js';
import Input from '../../components/ui/Input.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Button from '../../components/ui/Button.js';

const EVENT_OPTIONS = [
  { value: 'INVOICE_CREATED', label: 'Invoice created' },
  { value: 'INVOICE_CONFIRMED', label: 'Invoice confirmed' },
  { value: 'PAYMENT_RECEIVED', label: 'Payment received' },
  { value: 'CAMPAIGN_SENT', label: 'Campaign sent' },
  { value: 'CAMPAIGN_CANCELLED', label: 'Campaign cancelled' },
];

interface WebhookForm {
  targetUrl: string;
  events: string[];
  isActive: boolean;
}

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['webhook-subscriptions'],
    queryFn: () => integrationApi.listWebhooks(),
  });
  const subscriptions = data?.content ?? [];

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WebhookForm>({ defaultValues: { targetUrl: '', events: [], isActive: true } });

  const createMutation = useMutation({
    mutationFn: (payload: WebhookForm) => integrationApi.createWebhook(payload),
    onSuccess: (created) => {
      toast.success('Webhook subscription created');
      setNewSecret(created.secret);
      reset();
      void qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: WebhookForm & { id: number }) =>
      integrationApi.updateWebhook(payload.id, payload),
    onSuccess: () => {
      toast.success('Webhook subscription updated');
      setDrawerOpen(false);
      setEditingId(null);
      reset();
      void qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => integrationApi.deleteWebhook(id),
    onSuccess: () => {
      toast.success('Webhook subscription removed');
      void qc.invalidateQueries({ queryKey: ['webhook-subscriptions'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openEdit(sub: WebhookSubscription) {
    setEditingId(sub.id);
    reset({ targetUrl: sub.targetUrl, events: sub.events, isActive: sub.isActive });
    setDrawerOpen(true);
  }

  function onSubmit(data: WebhookForm) {
    if (data.events.length === 0) {
      toast.error('Select at least one event');
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...data });
    } else {
      createMutation.mutate(data);
    }
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Integrations"
        subtitle="Subscribe external systems to key business events with signed, verifiable webhook deliveries."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              reset({ targetUrl: '', events: [], isActive: true });
              setDrawerOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add Webhook
          </Button>
        }
      />

      {isLoading ? (
        <ERPTableSkeleton />
      ) : subscriptions.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No webhook subscriptions yet"
          description="Add a webhook to receive a signed HTTP POST when key events happen — invoice created, payment received, and more."
          action={{ label: 'Add Webhook', onClick: () => setDrawerOpen(true) }}
        />
      ) : (
        <div className="rounded-lg border border-default bg-surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-left text-xs font-medium text-secondary">
              <tr>
                <th className="px-4 py-2.5">Target URL</th>
                <th className="px-4 py-2.5">Events</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {subscriptions.map((sub: WebhookSubscription) => (
                <tr key={sub.id}>
                  <td className="px-4 py-3 text-primary">{sub.targetUrl}</td>
                  <td className="px-4 py-3 text-secondary">{sub.events.join(', ')}</td>
                  <td className="px-4 py-3">
                    <ERPStatusBadge status={sub.isActive ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      type="button"
                      aria-label="Edit webhook subscription"
                      className="text-secondary hover:text-primary"
                      onClick={() => openEdit(sub)}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete webhook subscription"
                      className="text-secondary hover:text-danger"
                      onClick={() => {
                        if (window.confirm('Remove this webhook subscription?')) {
                          deleteMutation.mutate(sub.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ERPDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setNewSecret(null);
          setEditingId(null);
        }}
        title={editingId !== null ? 'Edit Webhook Subscription' : 'Add Webhook Subscription'}
        subtitle="We'll sign every delivery with HMAC-SHA256 so you can verify it came from us."
      >
        {newSecret ? (
          <div className="space-y-4">
            <p className="text-sm text-primary">
              Your webhook secret — copy it now, it won&apos;t be shown again:
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-default bg-surface-subtle px-3 py-2.5">
              <code className="flex-1 text-xs break-all">{newSecret}</code>
              <button
                type="button"
                aria-label="Copy secret"
                onClick={() => {
                  void navigator.clipboard.writeText(newSecret);
                  toast.success('Copied to clipboard');
                }}
              >
                <Copy className="h-4 w-4 text-secondary hover:text-primary" />
              </button>
            </div>
            <Button
              className="w-full justify-center"
              onClick={() => {
                setDrawerOpen(false);
                setNewSecret(null);
              }}
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Target URL"
              placeholder="https://your-service.example.com/webhooks"
              {...register('targetUrl', { required: 'Required' })}
              error={errors.targetUrl?.message}
            />
            <div>
              <p className="text-sm font-medium text-primary mb-2">Events</p>
              <Controller
                control={control}
                name="events"
                render={({ field }) => (
                  <div className="space-y-2">
                    {EVENT_OPTIONS.map((opt) => (
                      <Checkbox
                        key={opt.value}
                        label={opt.label}
                        checked={field.value.includes(opt.value)}
                        onChange={(e) => {
                          field.onChange(
                            e.target.checked
                              ? [...field.value, opt.value]
                              : field.value.filter((v) => v !== opt.value)
                          );
                        }}
                      />
                    ))}
                  </div>
                )}
              />
            </div>
            <Checkbox label="Active" {...register('isActive')} />
            <Button
              type="submit"
              className="w-full justify-center"
              loading={isSubmitting || updateMutation.isPending}
            >
              {editingId !== null ? 'Save Changes' : 'Create Subscription'}
            </Button>
          </form>
        )}
      </ERPDrawer>
    </div>
  );
}
