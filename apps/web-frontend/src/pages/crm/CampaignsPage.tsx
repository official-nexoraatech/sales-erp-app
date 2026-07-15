import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDatetime } from '../../lib/format.js';
import Modal from '../../components/ui/Modal.js';
import DateTimePicker from '../../components/ui/DateTimePicker.js';

interface Campaign {
  id: number;
  name: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
  scheduledAt?: string;
  sentAt?: string;
  totalRecipients?: number;
  sentCount?: number;
  deliveredCount?: number;
  failedCount?: number;
  createdAt: string;
}

interface CampaignRecipient {
  id: number;
  customerId: number;
  customerName: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  errorMessage?: string | null;
  sentAt?: string | null;
}

function RecipientDrilldown({ campaignId }: { campaignId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign-recipients', campaignId],
    queryFn: () => crmApi.campaignRecipients(campaignId),
  });
  const recipients = (data as CampaignRecipient[] | undefined) ?? [];

  if (isLoading) return <p className="text-xs text-secondary px-5 py-2">Loading recipients…</p>;
  if (recipients.length === 0)
    return <p className="text-xs text-secondary px-5 py-2">No recipients yet.</p>;

  return (
    <div className="px-5 py-3 bg-surface-subtle max-h-64 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-secondary">
            <th className="pb-1">Customer</th>
            <th className="pb-1">Status</th>
            <th className="pb-1">Sent At</th>
            <th className="pb-1">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-default">
          {recipients.map((r) => (
            <tr key={r.id}>
              <td className="py-1">{r.customerName}</td>
              <td className="py-1">
                <Badge
                  label={r.status}
                  color={
                    r.status === 'FAILED' ? 'red' : r.status === 'PENDING' ? 'yellow' : 'green'
                  }
                />
              </td>
              <td className="py-1">{r.sentAt ? formatDatetime(r.sentAt) : '—'}</td>
              <td className="py-1 text-danger">{r.errorMessage ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_COLORS: Record<string, 'green' | 'yellow' | 'red' | 'blue' | 'gray'> = {
  DRAFT: 'gray',
  SCHEDULED: 'yellow',
  SENDING: 'blue',
  SENT: 'green',
  CANCELLED: 'gray',
  FAILED: 'red',
};

export default function CampaignsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.CRM_CAMPAIGN_CREATE);
  const canSend = hasPermission(PERMISSIONS.CRM_CAMPAIGN_SEND);

  const [statusFilter, setStatusFilter] = useState('');
  const [scheduleModal, setScheduleModal] = useState<{ open: boolean; id: number }>({
    open: false,
    id: 0,
  });
  const [scheduleAt, setScheduleAt] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // CP-4: client-side pagination — GET /crm/campaigns has no server-side page/size params yet
  // (see CP-4 completion report), so this paginates the already-fetched full list rather than
  // leaving a long, unpaginated table.
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', statusFilter],
    queryFn: () => crmApi.listCampaigns(statusFilter ? { status: statusFilter } : undefined),
  });
  const campaigns: Campaign[] = (data as { content?: Campaign[] })?.content ?? [];
  const pageCount = Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE));
  const pagedCampaigns = campaigns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const sendMut = useMutation({
    mutationFn: (id: number) => crmApi.sendCampaign(id),
    onSuccess: () => {
      toast.success('Campaign sent');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: () => toast.error('Failed to send campaign'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => crmApi.cancelCampaign(id),
    onSuccess: () => {
      toast.success('Campaign cancelled');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: () => toast.error('Failed to cancel campaign'),
  });

  const scheduleMut = useMutation({
    mutationFn: ({ id, scheduledAt }: { id: number; scheduledAt: string }) =>
      crmApi.scheduleCampaign(id, { scheduledAt }),
    onSuccess: () => {
      toast.success('Campaign scheduled');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      setScheduleModal({ open: false, id: 0 });
      setScheduleAt('');
    },
    onError: () => toast.error('Failed to schedule campaign'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Campaigns"
        subtitle="SMS, WhatsApp, Email and in-app marketing campaigns"
        actions={
          canCreate ? (
            <Button onClick={() => navigate('/crm/campaigns/new')}>+ New Campaign</Button>
          ) : undefined
        }
      />

      {/* Status filter */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {['', 'DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'FAILED'].map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatusFilter(s);
              setPage(0);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              statusFilter === s
                ? 'bg-primary text-white border-primary'
                : 'border-default text-secondary hover:bg-surface-raised'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={4} />
        ) : campaigns.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No campaigns found"
            description="SMS, WhatsApp, Email and in-app marketing campaigns will appear here."
            {...(canCreate
              ? {
                  action: {
                    label: '+ New Campaign',
                    onClick: () => navigate('/crm/campaigns/new'),
                  },
                }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {pagedCampaigns.map((c) => (
              <div key={c.id}>
                <div className="flex items-center gap-4 px-5 py-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-primary truncate">{c.name}</p>
                      <Badge label={c.status} color={STATUS_COLORS[c.status] ?? 'gray'} />
                      <Badge label={c.channel} color="blue" />
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-secondary">
                      {c.totalRecipients != null && (
                        <button
                          onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                          className="underline hover:text-primary"
                        >
                          {c.totalRecipients} recipients — {c.sentCount ?? 0} sent /{' '}
                          {c.deliveredCount ?? 0} delivered / {c.failedCount ?? 0} failed
                        </button>
                      )}
                      {c.scheduledAt && <span>Scheduled: {formatDatetime(c.scheduledAt)}</span>}
                      {c.sentAt && <span>Sent: {formatDatetime(c.sentAt)}</span>}
                      {!c.scheduledAt && !c.sentAt && (
                        <span>Created: {formatDatetime(c.createdAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {canCreate && (c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`/crm/campaigns/${c.id}/edit`)}
                      >
                        Edit
                      </Button>
                    )}
                    {canSend && c.status === 'DRAFT' && (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setScheduleModal({ open: true, id: c.id });
                            setScheduleAt('');
                          }}
                        >
                          Schedule
                        </Button>
                        <Button
                          size="sm"
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Send Campaign',
                              message: 'Send campaign now?',
                              confirmLabel: 'Send Now',
                            });
                            if (ok) sendMut.mutate(c.id);
                          }}
                          disabled={sendMut.isPending}
                        >
                          Send Now
                        </Button>
                      </>
                    )}
                    {canCreate && (c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Cancel Campaign',
                            message: 'Cancel this campaign?',
                            confirmLabel: 'Cancel Campaign',
                            variant: 'danger',
                          });
                          if (ok) cancelMut.mutate(c.id);
                        }}
                        disabled={cancelMut.isPending}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
                {expandedId === c.id && <RecipientDrilldown campaignId={c.id} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {campaigns.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-secondary">
          <span>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, campaigns.length)} of{' '}
            {campaigns.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="px-2 py-1.5">
              Page {page + 1} of {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      <Modal
        open={scheduleModal.open}
        onClose={() => setScheduleModal({ open: false, id: 0 })}
        title="Schedule Campaign"
      >
        <div className="space-y-5">
          <DateTimePicker
            label="Schedule Date & Time"
            value={scheduleAt}
            onChange={setScheduleAt}
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setScheduleModal({ open: false, id: 0 })}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                scheduleMut.mutate({
                  id: scheduleModal.id,
                  scheduledAt: new Date(scheduleAt).toISOString(),
                })
              }
              disabled={scheduleMut.isPending || !scheduleAt}
            >
              {scheduleMut.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
