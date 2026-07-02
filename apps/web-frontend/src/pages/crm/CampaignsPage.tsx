import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDatetime } from '../../lib/format.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

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
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.CRM_CAMPAIGN_CREATE);
  const canSend = hasPermission(PERMISSIONS.CRM_CAMPAIGN_SEND);

  const [statusFilter, setStatusFilter] = useState('');
  const [scheduleModal, setScheduleModal] = useState<{ open: boolean; id: number }>({ open: false, id: 0 });
  const [scheduleAt, setScheduleAt] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns', statusFilter],
    queryFn: () => crmApi.listCampaigns(statusFilter ? { status: statusFilter } : undefined),
  });
  const campaigns: Campaign[] = (data as Record<string, unknown>)?.data as Campaign[] ?? [];

  const sendMut = useMutation({
    mutationFn: (id: number) => crmApi.sendCampaign(id),
    onSuccess: () => { toast.success('Campaign sent'); qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError: () => toast.error('Failed to send campaign'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => crmApi.cancelCampaign(id),
    onSuccess: () => { toast.success('Campaign cancelled'); qc.invalidateQueries({ queryKey: ['campaigns'] }); },
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
            onClick={() => setStatusFilter(s)}
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
          <div className="p-8 text-center text-sm text-secondary">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="p-8 text-center text-sm text-secondary">No campaigns found.</div>
        ) : (
          <div className="divide-y divide-default">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-primary truncate">{c.name}</p>
                    <Badge label={c.status} color={STATUS_COLORS[c.status] ?? 'gray'} />
                    <Badge label={c.channel} color="blue" />
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-secondary">
                    {c.totalRecipients != null && (
                      <span>{c.totalRecipients} recipients — {c.sentCount ?? 0} sent / {c.deliveredCount ?? 0} delivered / {c.failedCount ?? 0} failed</span>
                    )}
                    {c.scheduledAt && <span>Scheduled: {formatDatetime(c.scheduledAt)}</span>}
                    {c.sentAt && <span>Sent: {formatDatetime(c.sentAt)}</span>}
                    {!c.scheduledAt && !c.sentAt && <span>Created: {formatDatetime(c.createdAt)}</span>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {canSend && c.status === 'DRAFT' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => { setScheduleModal({ open: true, id: c.id }); setScheduleAt(''); }}
                      >
                        Schedule
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => { if (confirm('Send campaign now?')) sendMut.mutate(c.id); }}
                        disabled={sendMut.isPending}
                      >
                        Send Now
                      </Button>
                    </>
                  )}
                  {(c.status === 'DRAFT' || c.status === 'SCHEDULED') && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => { if (confirm('Cancel this campaign?')) cancelMut.mutate(c.id); }}
                      disabled={cancelMut.isPending}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule Modal */}
      <Modal
        open={scheduleModal.open}
        onClose={() => setScheduleModal({ open: false, id: 0 })}
        title="Schedule Campaign"
      >
        <div className="space-y-5">
          <Input
            label="Schedule Date & Time"
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setScheduleModal({ open: false, id: 0 })}>Cancel</Button>
            <Button
              onClick={() => scheduleMut.mutate({ id: scheduleModal.id, scheduledAt: scheduleAt })}
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
