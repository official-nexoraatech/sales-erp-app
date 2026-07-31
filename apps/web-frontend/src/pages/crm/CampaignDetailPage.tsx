import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi, branchApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge, { type BadgeVariant } from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import DateTimePicker from '../../components/ui/DateTimePicker.js';
import Input from '../../components/ui/Input.js';
import { formatDatetime, formatCurrency } from '../../lib/format.js';

interface Campaign {
  id: number;
  name: string;
  channel: 'SMS' | 'WHATSAPP' | 'EMAIL' | 'IN_APP';
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' | 'FAILED';
  approvalStatus?: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | null;
  rejectionReason?: string | null;
  messageTemplate: string;
  campaignType?: string | null;
  segmentId?: number | null;
  branchId?: number | null;
  scheduledAt?: string | null;
  sentAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  totalRecipients?: number;
  sentCount?: number;
  deliveredCount?: number;
  failedCount?: number;
}

interface CampaignVariantStat {
  id: number;
  label: string;
  sent: number;
  opened: number;
  clicked: number;
  converted: number;
}

interface CampaignStats {
  total: number;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
  // CRM-ROADMAP Phase 2, Feature 6 — real numbers for the first time.
  opened: number;
  clicked: number;
  converted: number;
  openRate: number;
  clickRate: number;
  conversionRate: number;
  // CRM-ROADMAP Phase 3, Feature 3 — spend-vs-revenue.
  revenue: number;
  cost: number;
  roi: number | null;
  variants: CampaignVariantStat[];
}

interface CampaignRecipient {
  id: number;
  customerId: number;
  customerName: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  errorMessage?: string | null;
  sentAt?: string | null;
}

interface CampaignHistoryEntry {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: number;
  createdAt: string;
}

interface CampaignComment {
  id: number;
  authorId: number;
  body: string;
  createdAt: string;
}

interface Segment {
  id: number;
  name: string;
}

interface Branch {
  id: number;
  name: string;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  DRAFT: 'default',
  SCHEDULED: 'warning',
  SENDING: 'info',
  SENT: 'success',
  CANCELLED: 'default',
  FAILED: 'danger',
};

const APPROVAL_VARIANT: Record<string, BadgeVariant> = {
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const campaignId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.CRM_CAMPAIGN_CREATE);
  const canSend = hasPermission(PERMISSIONS.CRM_CAMPAIGN_SEND);
  const canApprove = hasPermission(PERMISSIONS.CRM_CAMPAIGN_APPROVE);
  const canViewAnalytics = hasPermission(PERMISSIONS.CRM_CAMPAIGN_ANALYTICS_VIEW);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [commentBody, setCommentBody] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-campaign', campaignId],
    queryFn: () => crmApi.getCampaign(campaignId),
    enabled: !!campaignId,
  });
  const campaign = data as Campaign | undefined;

  const { data: segData } = useQuery({
    queryKey: ['crm-segments'],
    queryFn: () => crmApi.listSegments(),
  });
  const segments: Segment[] = (segData as { content?: Segment[] })?.content ?? [];

  const { data: branchData } = useQuery({
    queryKey: ['branches-for-campaign'],
    queryFn: () => branchApi.list({ size: 100 }),
  });
  const branches: Branch[] = (branchData as { content?: Branch[] })?.content ?? [];

  const { data: statsData } = useQuery({
    queryKey: ['campaign-stats', campaignId],
    queryFn: () => crmApi.campaignStats(campaignId),
    enabled: !!campaignId && canViewAnalytics,
  });
  const stats = statsData as CampaignStats | undefined;

  const { data: recipientsData } = useQuery({
    queryKey: ['campaign-recipients', campaignId],
    queryFn: () => crmApi.campaignRecipients(campaignId),
    enabled: !!campaignId && canViewAnalytics,
  });
  const recipients = (recipientsData as CampaignRecipient[] | undefined) ?? [];

  const { data: historyData } = useQuery({
    queryKey: ['campaign-history', campaignId],
    queryFn: () => crmApi.campaignHistory(campaignId),
    enabled: !!campaignId,
  });
  const history = (historyData as CampaignHistoryEntry[] | undefined) ?? [];

  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ['campaign-comments', campaignId],
    queryFn: () => crmApi.listCampaignComments(campaignId),
    enabled: !!campaignId,
  });
  const comments = (commentsData as { content?: CampaignComment[] })?.content ?? [];

  // CRM-ROADMAP Phase 3, Feature 5 — per-language variants for this campaign.
  const { data: translationsData } = useQuery({
    queryKey: ['campaign-translations', campaignId],
    queryFn: () => crmApi.campaignTranslations(campaignId),
    enabled: !!campaignId,
  });
  const translations =
    (
      translationsData as
        { content?: Array<{ language: string; messageTemplate: string }> } | undefined
    )?.content ?? [];
  const [newLanguage, setNewLanguage] = useState('');
  const [newLanguageTemplate, setNewLanguageTemplate] = useState('');

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ['crm-campaign', campaignId] });
    void qc.invalidateQueries({ queryKey: ['campaigns'] });
    void qc.invalidateQueries({ queryKey: ['campaign-history', campaignId] });
  }

  const sendMut = useMutation({
    mutationFn: () => crmApi.sendCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign sent');
      invalidate();
    },
    onError: () => toast.error('Failed to send campaign'),
  });

  const cancelMut = useMutation({
    mutationFn: () => crmApi.cancelCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign cancelled');
      invalidate();
    },
    onError: () => toast.error('Failed to cancel campaign'),
  });

  const scheduleMut = useMutation({
    mutationFn: () =>
      crmApi.scheduleCampaign(campaignId, { scheduledAt: new Date(scheduleAt).toISOString() }),
    onSuccess: () => {
      toast.success('Campaign scheduled');
      invalidate();
      setScheduleOpen(false);
      setScheduleAt('');
    },
    onError: () => toast.error('Failed to schedule campaign'),
  });

  const submitForApprovalMut = useMutation({
    mutationFn: () => crmApi.submitCampaignForApproval(campaignId),
    onSuccess: () => {
      toast.success('Campaign submitted for approval');
      invalidate();
    },
    onError: () => toast.error('Failed to submit campaign for approval'),
  });

  const approveMut = useMutation({
    mutationFn: () => crmApi.approveCampaign(campaignId),
    onSuccess: () => {
      toast.success('Campaign approved');
      invalidate();
    },
    onError: () => toast.error('Failed to approve campaign'),
  });

  const rejectMut = useMutation({
    mutationFn: () => crmApi.rejectCampaign(campaignId, rejectReason),
    onSuccess: () => {
      toast.success('Campaign rejected');
      invalidate();
      setRejectOpen(false);
      setRejectReason('');
    },
    onError: () => toast.error('Failed to reject campaign'),
  });

  const addCommentMut = useMutation({
    mutationFn: () => crmApi.createCampaignComment(campaignId, commentBody),
    onSuccess: () => {
      setCommentBody('');
      void refetchComments();
    },
    onError: () => toast.error('Failed to add comment'),
  });

  // CRM-ROADMAP Phase 3, Feature 5 — replaces the whole translation set for this campaign.
  const saveTranslationsMut = useMutation({
    mutationFn: (next: Array<{ language: string; messageTemplate: string }>) =>
      crmApi.updateCampaignTranslations(campaignId, next),
    onSuccess: () => {
      toast.success('Language variants saved');
      void qc.invalidateQueries({ queryKey: ['campaign-translations', campaignId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function addLanguageVariant(): void {
    if (!newLanguage.trim() || !newLanguageTemplate.trim()) return;
    if (translations.some((t) => t.language === newLanguage.trim())) {
      toast.error(`A variant for "${newLanguage.trim()}" already exists`);
      return;
    }
    saveTranslationsMut.mutate([
      ...translations,
      { language: newLanguage.trim(), messageTemplate: newLanguageTemplate.trim() },
    ]);
    setNewLanguage('');
    setNewLanguageTemplate('');
  }

  function removeLanguageVariant(language: string): void {
    saveTranslationsMut.mutate(translations.filter((t) => t.language !== language));
  }

  if (isLoading) return <ERPDetailSkeleton />;
  if (!campaign) return <ERPEmptyState type="no-data" title="Campaign not found" />;

  const segmentName = segments.find((s) => s.id === campaign.segmentId)?.name;
  const branchName = branches.find((b) => b.id === campaign.branchId)?.name;
  const canEdit = canCreate && (campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED');
  const canSubmitForApproval =
    canCreate &&
    campaign.status === 'DRAFT' &&
    campaign.approvalStatus !== 'PENDING_APPROVAL' &&
    campaign.approvalStatus !== 'APPROVED';
  const canApproveReject = canApprove && campaign.approvalStatus === 'PENDING_APPROVAL';
  const canSendNow = canSend && campaign.status === 'DRAFT';
  const canCancel = canCreate && (campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED');

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={campaign.name}
        entityType="Campaign"
        status={campaign.status}
        statusVariant={STATUS_VARIANT[campaign.status] ?? 'default'}
        backTo="/crm/campaigns"
      >
        <div className="flex flex-wrap items-center gap-2">
          {campaign.approvalStatus && (
            <Badge
              label={campaign.approvalStatus.replace('_', ' ')}
              variant={APPROVAL_VARIANT[campaign.approvalStatus] ?? 'default'}
            />
          )}
          {canEdit && (
            <Button
              variant="secondary"
              onClick={() => navigate(`/crm/campaigns/${campaignId}/edit`)}
            >
              Edit
            </Button>
          )}
          {canSubmitForApproval && (
            <Button
              variant="secondary"
              onClick={() => submitForApprovalMut.mutate()}
              disabled={submitForApprovalMut.isPending}
            >
              Submit for Approval
            </Button>
          )}
          {canApproveReject && (
            <>
              <Button onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
                Approve
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setRejectOpen(true);
                  setRejectReason('');
                }}
              >
                Reject
              </Button>
            </>
          )}
          {canSendNow && (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setScheduleOpen(true);
                  setScheduleAt('');
                }}
              >
                Schedule
              </Button>
              <Button
                data-tour-id="crm-campaign-detail-send-now-button"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Send Campaign',
                    message: `This will send "${campaign.name}" via ${campaign.channel} to ${campaign.totalRecipients ?? 'all matching'} recipient(s) right now. This can't be undone.`,
                    confirmLabel: 'Send Now',
                  });
                  if (ok) sendMut.mutate();
                }}
                disabled={sendMut.isPending}
              >
                Send Now
              </Button>
            </>
          )}
          {canCancel && (
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Cancel Campaign',
                  message: 'Cancel this campaign?',
                  confirmLabel: 'Cancel Campaign',
                  variant: 'danger',
                });
                if (ok) cancelMut.mutate();
              }}
              disabled={cancelMut.isPending}
            >
              Cancel
            </Button>
          )}
        </div>
      </ERPPageHeader>

      {campaign.approvalStatus === 'REJECTED' && campaign.rejectionReason && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          Rejected: {campaign.rejectionReason}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Channel', value: campaign.channel },
          { label: 'Campaign Type', value: campaign.campaignType ?? '—' },
          {
            label: 'Target Segment',
            value: segmentName ?? (campaign.segmentId ? `#${campaign.segmentId}` : '—'),
          },
          {
            label: 'Branch',
            value: branchName ?? (campaign.branchId ? `#${campaign.branchId}` : 'All Branches'),
          },
          { label: 'Created', value: formatDatetime(campaign.createdAt) },
          {
            label: 'Scheduled',
            value: campaign.scheduledAt ? formatDatetime(campaign.scheduledAt) : '—',
          },
          { label: 'Sent', value: campaign.sentAt ? formatDatetime(campaign.sentAt) : '—' },
          {
            label: 'Cancelled',
            value: campaign.cancelledAt ? formatDatetime(campaign.cancelledAt) : '—',
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card border border-default rounded-xl p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-base font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-2 text-sm">Message Content</h3>
        <div className="rounded-lg bg-surface-raised p-3 text-sm whitespace-pre-wrap">
          {campaign.messageTemplate}
        </div>
      </div>

      {canViewAnalytics && stats && stats.total > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3 text-sm">Delivery Stats</h3>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Total', value: stats.total },
              { label: 'Sent', value: stats.sent },
              { label: 'Delivered', value: stats.delivered },
              { label: 'Failed', value: stats.failed },
              { label: 'Pending', value: stats.pending },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-xl font-bold text-primary">{value}</p>
                <p className="text-xs text-secondary">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CRM-ROADMAP Phase 2, Feature 6 — real engagement numbers for the first time; this
          block simply doesn't exist until a campaign has actually been sent. */}
      {canViewAnalytics && stats && stats.total > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3 text-sm">Engagement</h3>
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[
              { label: 'Open Rate', value: stats.openRate, count: stats.opened },
              { label: 'Click Rate', value: stats.clickRate, count: stats.clicked },
              { label: 'Conversion Rate', value: stats.conversionRate, count: stats.converted },
            ].map(({ label, value, count }) => (
              <div key={label} className="text-center">
                <p className="text-xl font-bold text-primary">{value}%</p>
                <p className="text-xs text-secondary">
                  {label} ({count})
                </p>
              </div>
            ))}
          </div>

          {stats.variants.length > 0 && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-secondary border-b border-default">
                    <th className="pb-2">Variant</th>
                    <th className="pb-2">Sent</th>
                    <th className="pb-2">Opened</th>
                    <th className="pb-2">Clicked</th>
                    <th className="pb-2">Converted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {stats.variants.map((v) => (
                    <tr key={v.id}>
                      <td className="py-2 font-medium">{v.label}</td>
                      <td className="py-2">{v.sent}</td>
                      <td className="py-2">{v.opened}</td>
                      <td className="py-2">{v.clicked}</td>
                      <td className="py-2">{v.converted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CRM-ROADMAP Phase 3, Feature 3 — spend-vs-revenue. Cost is a live estimate
          (sentCount × the tenant's configured per-channel rate), not a historical snapshot —
          see CampaignService.getStats' own comment. */}
      {canViewAnalytics && stats && stats.total > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3 text-sm">Revenue & Cost</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xl font-bold text-primary">{formatCurrency(stats.revenue)}</p>
              <p className="text-xs text-secondary">Attributed Revenue</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-primary">{formatCurrency(stats.cost)}</p>
              <p className="text-xs text-secondary">Estimated Cost</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-primary">
                {stats.roi === null ? '—' : `${(stats.roi * 100).toFixed(0)}%`}
              </p>
              <p className="text-xs text-secondary">ROI</p>
            </div>
          </div>
        </div>
      )}

      {/* CRM-ROADMAP Phase 3, Feature 5 — a recipient whose preferredLanguage matches one of
          these gets that variant instead of the base messageTemplate above; everyone else
          (including when this list is empty) gets the base template unchanged. */}
      {(translations.length > 0 || canEdit) && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3 text-sm">Language Variants</h3>
          {translations.length === 0 && (
            <p className="text-sm text-secondary mb-3">
              No language variants — every recipient gets the base message template above.
            </p>
          )}
          <div className="space-y-2 mb-3">
            {translations.map((t) => (
              <div key={t.language} className="border border-default rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <Badge label={t.language} variant="info" />
                  {canEdit && (
                    <button
                      type="button"
                      className="text-xs text-danger hover:underline"
                      onClick={() => removeLanguageVariant(t.language)}
                      disabled={saveTranslationsMut.isPending}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-sm text-secondary whitespace-pre-wrap">{t.messageTemplate}</p>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2 items-start">
              <Input
                placeholder="Language (e.g. hi, ta)"
                value={newLanguage}
                onChange={(e) => setNewLanguage(e.target.value)}
                className="sm:w-40"
              />
              <textarea
                value={newLanguageTemplate}
                onChange={(e) => setNewLanguageTemplate(e.target.value)}
                placeholder="Message for this language…"
                className="flex-1 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
                rows={2}
              />
              <Button
                onClick={addLanguageVariant}
                disabled={
                  saveTranslationsMut.isPending ||
                  !newLanguage.trim() ||
                  !newLanguageTemplate.trim()
                }
              >
                Add
              </Button>
            </div>
          )}
        </div>
      )}

      {canViewAnalytics && recipients.length > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-3 text-sm">Recipients ({recipients.length})</h3>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary border-b border-default">
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Sent At</th>
                  <th className="pb-2">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {recipients.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{r.customerName}</td>
                    <td className="py-2">
                      <Badge
                        label={r.status}
                        variant={
                          r.status === 'FAILED'
                            ? 'danger'
                            : r.status === 'PENDING'
                              ? 'warning'
                              : 'success'
                        }
                      />
                    </td>
                    <td className="py-2">{r.sentAt ? formatDatetime(r.sentAt) : '—'}</td>
                    <td className="py-2 text-danger">{r.errorMessage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3 text-sm">Comments</h3>
        <div className="space-y-2 mb-3">
          {comments.length === 0 && <p className="text-sm text-secondary">No comments yet.</p>}
          {comments.map((c) => (
            <div key={c.id} className="border-b border-default last:border-0 pb-2 last:pb-0">
              <p className="text-sm">{c.body}</p>
              <p className="text-xs text-secondary mt-0.5">{formatDatetime(c.createdAt)}</p>
            </div>
          ))}
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add an internal note (never sent to recipients)…"
              className="flex-1 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              rows={2}
            />
            <Button
              onClick={() => addCommentMut.mutate()}
              disabled={addCommentMut.isPending || !commentBody.trim()}
            >
              Add
            </Button>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-sm">History</h3>
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between text-sm border-b border-default last:border-0 pb-2 last:pb-0"
              >
                <span>
                  {h.action.replace(/_/g, ' ')}
                  {h.fromStatus && (
                    <span className="text-secondary">
                      {' '}
                      — {h.fromStatus} → {h.toStatus}
                    </span>
                  )}
                </span>
                <span className="text-xs text-secondary">{formatDatetime(h.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule Campaign">
        <div className="space-y-5">
          <DateTimePicker
            label="Schedule Date & Time"
            value={scheduleAt}
            onChange={setScheduleAt}
          />
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => scheduleMut.mutate()}
              disabled={scheduleMut.isPending || !scheduleAt}
            >
              {scheduleMut.isPending ? 'Scheduling…' : 'Schedule'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject Campaign">
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">
              Reason for rejection
            </label>
            <textarea
              className="w-full rounded-lg border border-default bg-surface-card px-3 py-2 text-sm"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain what needs to change before this campaign can be resubmitted"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => rejectMut.mutate()}
              disabled={rejectMut.isPending || !rejectReason.trim()}
            >
              {rejectMut.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
