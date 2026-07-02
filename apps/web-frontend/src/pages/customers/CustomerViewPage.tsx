import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { customerApi, crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

type ActivityType =
  | 'INVOICE' | 'PAYMENT' | 'RETURN' | 'ALTERATION'
  | 'LOYALTY_EARN' | 'LOYALTY_REDEEM' | 'LOYALTY_EXPIRE'
  | 'VISIT' | 'CALL' | 'COMPLAINT' | 'EMAIL' | 'WHATSAPP' | 'OTHER';

interface ActivityItem {
  type: ActivityType;
  date: string;
  id: number;
  [key: string]: unknown;
}

interface Interaction {
  id: number;
  type: string;
  notes?: string;
  followUpDate?: string;
  followUpDone?: boolean;
  createdAt: string;
}

const INTERACTION_TYPES = ['VISIT', 'CALL', 'COMPLAINT', 'EMAIL', 'WHATSAPP', 'OTHER'] as const;

const ACTIVITY_COLOR: Record<string, string> = {
  INVOICE: 'text-blue-500',
  PAYMENT: 'text-green-500',
  RETURN: 'text-red-400',
  ALTERATION: 'text-purple-500',
  LOYALTY_EARN: 'text-yellow-500',
  LOYALTY_REDEEM: 'text-yellow-600',
  LOYALTY_EXPIRE: 'text-gray-400',
  VISIT: 'text-teal-500',
  CALL: 'text-teal-400',
  COMPLAINT: 'text-red-500',
  EMAIL: 'text-blue-400',
  WHATSAPP: 'text-green-400',
  OTHER: 'text-gray-400',
};

function activityLabel(item: ActivityItem): string {
  switch (item.type) {
    case 'INVOICE': return `Invoice #${String(item.invoiceNumber ?? item.id)} — ₹${Number(item.grandTotal ?? 0).toLocaleString()}`;
    case 'PAYMENT': return `Payment ₹${Number(item.amount ?? 0).toLocaleString()} via ${String(item.paymentMode ?? '')}`;
    case 'RETURN': return `Return #${String(item.returnNumber ?? item.id)}`;
    case 'ALTERATION': return `Alteration #${item.id}`;
    case 'LOYALTY_EARN': return `+${item.pointsEarned ?? 0} loyalty points`;
    case 'LOYALTY_REDEEM': return `-${item.pointsRedeemed ?? 0} points redeemed`;
    case 'LOYALTY_EXPIRE': return `${item.pointsExpired ?? 0} points expired`;
    default: return `${item.type} — ${String(item.notes ?? '')}`;
  }
}

const BLANK_INTERACTION = { type: 'VISIT' as string, notes: '', followUpDate: '' };

export default function CustomerViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canLogInteraction = hasPermission(PERMISSIONS.CRM_INTERACTION_CREATE);
  const canViewInteractions = hasPermission(PERMISSIONS.CRM_INTERACTION_VIEW);

  const [tab, setTab] = useState<'details' | 'timeline' | 'interactions'>('details');
  const [logOpen, setLogOpen] = useState(false);
  const [interactionForm, setInteractionForm] = useState({ ...BLANK_INTERACTION });
  const [timelinePage, setTimelinePage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => customerApi.getById(Number(id)),
  });
  const customer = (data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;

  const { data: timelineData, isFetching: timelineFetching } = useQuery({
    queryKey: ['customer-timeline', id, timelinePage],
    queryFn: () => crmApi.activityTimeline(Number(id), { page: timelinePage, size: 20 }),
    enabled: tab === 'timeline',
  });
  const timelineItems: ActivityItem[] = (timelineData as Record<string, unknown>)?.items as ActivityItem[] ?? [];
  const timelineTotal: number = (timelineData as Record<string, unknown>)?.total as number ?? 0;

  const { data: interactionData } = useQuery({
    queryKey: ['customer-interactions', id],
    queryFn: () => crmApi.listInteractions(Number(id)),
    enabled: tab === 'interactions' && canViewInteractions,
  });
  const interactions: Interaction[] = (interactionData as Record<string, unknown>)?.data as Interaction[] ?? [];

  const logMut = useMutation({
    mutationFn: () =>
      crmApi.logInteraction(Number(id), {
        type: interactionForm.type,
        notes: interactionForm.notes || undefined,
        followUpDate: interactionForm.followUpDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Interaction logged');
      qc.invalidateQueries({ queryKey: ['customer-interactions', id] });
      qc.invalidateQueries({ queryKey: ['customer-timeline', id] });
      setLogOpen(false);
      setInteractionForm({ ...BLANK_INTERACTION });
    },
    onError: () => toast.error('Failed to log interaction'),
  });

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!customer) return <p className="text-sm text-red-400">Customer not found.</p>;

  const billing = customer.billingAddress as Record<string, string> | undefined;
  const healthSeg = customer.healthSegment as string | undefined;
  const healthScore = customer.healthScore as number | undefined;

  const healthColor: Record<string, 'green' | 'blue' | 'yellow' | 'red' | 'gray'> = {
    CHAMPION: 'green', LOYAL: 'blue', AT_RISK: 'yellow', LOST: 'red',
  };

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={String(customer.displayName)}
        subtitle={`Customer Code: ${customer.customerCode}`}
        actions={
          <div className="flex gap-2">
            {canLogInteraction && (
              <Button onClick={() => setLogOpen(true)}>+ Log Interaction</Button>
            )}
            <Button variant="secondary" onClick={() => navigate(`/customers/${id}/edit`)}>Edit</Button>
            <Button variant="secondary" onClick={() => navigate('/customers')}>Back</Button>
          </div>
        }
      />

      {/* Health score strip */}
      {healthSeg && (
        <div className="mb-4 flex items-center gap-3 bg-surface-card rounded-xl border border-default px-5 py-3">
          <span className="text-xs text-secondary font-medium uppercase tracking-wide">Health</span>
          <Badge label={healthSeg} color={healthColor[healthSeg] ?? 'gray'} />
          {healthScore != null && (
            <div className="flex-1 max-w-xs">
              <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${healthScore}%` }}
                />
              </div>
            </div>
          )}
          {healthScore != null && <span className="text-xs text-secondary">{healthScore}/100</span>}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-default">
        {(['details', 'timeline', 'interactions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t === 'timeline' ? 'Activity Timeline' : t === 'interactions' ? 'Interactions' : 'Details'}
          </button>
        ))}
      </div>

      {/* Details Tab */}
      {tab === 'details' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 uppercase tracking-wide">Details</h2>
              <dl className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Phone', value: customer.phone },
                  { label: 'Email', value: customer.email },
                  { label: 'GSTIN', value: customer.gstin },
                  { label: 'PAN', value: customer.pan },
                  { label: 'Type', value: customer.customerType },
                  { label: 'Status', value: <Badge label={String(customer.status)} color={customer.status === 'ACTIVE' ? 'green' : 'gray'} /> },
                  { label: 'Date of Birth', value: customer.dateOfBirth ? formatDate(String(customer.dateOfBirth)) : undefined },
                  { label: 'Loyalty Card', value: customer.loyaltyCardNumber },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-gray-400">{label}</dt>
                    <dd className="text-sm text-gray-800 dark:text-gray-200 font-medium">{value as React.ReactNode ?? '–'}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {billing && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">Billing Address</h2>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  {billing.addressLine1}{billing.city ? `, ${billing.city}` : ''}{billing.state ? `, ${billing.state}` : ''} {billing.pinCode}
                </p>
              </div>
            )}
          </div>
          <div className="space-y-4">
            {[
              { label: 'Credit Limit', value: formatCurrency(Number(customer.creditLimit ?? 0)) },
              { label: 'Credit Days', value: `${customer.creditDays ?? 0} days` },
              { label: 'Opening Balance', value: formatCurrency(Number(customer.openingBalance ?? 0)) },
              { label: 'Loyalty Points', value: String(customer.loyaltyPoints ?? 0) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity Timeline Tab */}
      {tab === 'timeline' && (
        <div className="bg-surface-card rounded-xl border border-default">
          {timelineFetching ? (
            <div className="p-8 text-center text-sm text-secondary">Loading…</div>
          ) : timelineItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-secondary">No activity recorded yet.</div>
          ) : (
            <>
              <div className="divide-y divide-default">
                {timelineItems.map((item, i) => (
                  <div key={`${item.type}-${item.id}-${i}`} className="flex items-start gap-4 px-5 py-3">
                    <div className={`mt-0.5 text-xs font-bold uppercase ${ACTIVITY_COLOR[item.type] ?? 'text-gray-400'}`}>
                      {item.type.replace(/_/g, ' ')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-primary">{activityLabel(item)}</p>
                      <p className="text-xs text-secondary mt-0.5">{formatDatetime(item.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-default flex items-center justify-between text-xs text-secondary">
                <span>{timelineTotal} total events</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTimelinePage((p) => Math.max(0, p - 1))}
                    disabled={timelinePage === 0}
                  >
                    ← Prev
                  </Button>
                  <span className="px-2 py-1">Page {timelinePage + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTimelinePage((p) => p + 1)}
                    disabled={(timelinePage + 1) * 20 >= timelineTotal}
                  >
                    Next →
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Interactions Tab */}
      {tab === 'interactions' && (
        <div className="bg-surface-card rounded-xl border border-default">
          {!canViewInteractions ? (
            <div className="p-8 text-center text-sm text-secondary">No permission to view interactions.</div>
          ) : interactions.length === 0 ? (
            <div className="p-8 text-center text-sm text-secondary">No interactions logged yet.</div>
          ) : (
            <div className="divide-y divide-default">
              {interactions.map((i) => (
                <div key={i.id} className="flex items-start gap-4 px-5 py-3">
                  <Badge label={i.type} color="blue" />
                  <div className="flex-1 min-w-0">
                    {i.notes && <p className="text-sm text-primary">{i.notes}</p>}
                    {i.followUpDate && (
                      <p className={`text-xs mt-0.5 ${i.followUpDone ? 'text-secondary line-through' : 'text-warning'}`}>
                        Follow-up: {formatDate(i.followUpDate)}
                        {i.followUpDone ? ' (done)' : ''}
                      </p>
                    )}
                    <p className="text-xs text-secondary mt-0.5">{formatDatetime(i.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log Interaction Modal */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log Customer Interaction"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Interaction Type</label>
            <div className="flex gap-2 flex-wrap">
              {INTERACTION_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setInteractionForm((f) => ({ ...f, type: t }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    interactionForm.type === t
                      ? 'bg-primary text-white border-primary'
                      : 'border-default text-secondary hover:bg-surface-raised'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Notes (optional)</label>
            <textarea
              value={interactionForm.notes}
              onChange={(e) => setInteractionForm((f) => ({ ...f, notes: e.target.value }))}
              rows={3}
              placeholder="What was discussed…"
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Follow-up Date (optional)</label>
            <input
              type="date"
              value={interactionForm.followUpDate}
              onChange={(e) => setInteractionForm((f) => ({ ...f, followUpDate: e.target.value }))}
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setLogOpen(false)}>Cancel</Button>
            <Button onClick={() => logMut.mutate()} disabled={logMut.isPending}>
              {logMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
