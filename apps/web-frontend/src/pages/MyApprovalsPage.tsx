import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  approvalApi,
  type PendingApprovalItem,
  type WorkflowApprovalStatus,
} from '../api/endpoints.js';
import { useConfirm } from '../context/ConfirmContext.js';
import ERPPageHeader from '../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';
import Button from '../components/ui/Button.js';
import Badge from '../components/ui/Badge.js';
import { formatDatetime } from '../lib/format.js';

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  ESCALATED: 'danger',
  EXPIRED: 'danger',
  CANCELLED: 'default',
};

export default function MyApprovalsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<PendingApprovalItem | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [showReject, setShowReject] = useState(false);

  const { data: listData, isLoading } = useQuery({
    queryKey: ['my-approvals-pending'],
    queryFn: () => approvalApi.pending(),
    refetchInterval: 60_000,
  });
  const items: PendingApprovalItem[] = listData?.content ?? [];

  const { data: statusData, isLoading: statusLoading } = useQuery<WorkflowApprovalStatus>({
    queryKey: ['my-approvals-status', selected?.instanceId],
    queryFn: () => approvalApi.status(selected!.instanceId),
    enabled: !!selected,
  });

  const approveMutation = useMutation({
    mutationFn: ({ instanceId, nodeId }: { instanceId: number; nodeId: string }) =>
      approvalApi.approve(instanceId, { nodeId }),
    onSuccess: () => {
      toast.success('Approved');
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['my-approvals-pending'] });
    },
    onError: () => toast.error('Failed to approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      instanceId,
      nodeId,
      comment,
    }: {
      instanceId: number;
      nodeId: string;
      comment: string;
    }) => approvalApi.reject(instanceId, { nodeId, comment }),
    onSuccess: () => {
      toast.success('Rejected');
      setSelected(null);
      setShowReject(false);
      setRejectComment('');
      void qc.invalidateQueries({ queryKey: ['my-approvals-pending'] });
    },
    onError: () => toast.error('Failed to reject'),
  });

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="My Approvals"
        subtitle="High-value invoices, purchase orders, expenses, and other transactions routed to you for sign-off"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-primary mb-3">Pending your decision</h3>
          {isLoading ? (
            <ERPCardSkeleton lines={4} />
          ) : items.length === 0 ? (
            <ERPEmptyState
              type="no-data"
              title="Nothing pending"
              description="Transactions routed to you for approval will appear here."
            />
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div
                  key={item.approvalId}
                  className={`px-3 py-3 rounded-lg border border-default cursor-pointer transition-colors ${
                    selected?.approvalId === item.approvalId
                      ? 'bg-surface-hover'
                      : 'hover:bg-surface-hover'
                  }`}
                  onClick={() => setSelected(item)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-primary">{item.nodeName}</span>
                    <Badge variant="warning">PENDING</Badge>
                  </div>
                  <p className="text-xs text-secondary">
                    {item.entityType} #{item.entityId}
                  </p>
                  <p className="text-xs text-secondary mt-1">
                    Requested {formatDatetime(item.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-primary mb-3">
            {selected ? `${selected.entityType} #${selected.entityId}` : 'Details'}
          </h3>
          {!selected ? (
            <p className="text-sm text-secondary">Select an item to review and decide</p>
          ) : statusLoading || !statusData ? (
            <ERPCardSkeleton lines={5} />
          ) : (
            <div className="space-y-4">
              <div>
                <Badge variant={STATUS_VARIANT[statusData.status] ?? 'default'}>
                  {statusData.status}
                </Badge>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {statusData.history.map((h) => (
                  <div key={h.id} className="px-2 py-2 rounded-lg border border-default text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-primary">{h.nodeName}</span>
                      <Badge variant={STATUS_VARIANT[h.action] ?? 'default'}>{h.action}</Badge>
                    </div>
                    {h.comment && <p className="text-secondary mt-1">{h.comment}</p>}
                  </div>
                ))}
              </div>

              {statusData.status === 'PENDING' && (
                <div className="space-y-2">
                  {showReject ? (
                    <>
                      <textarea
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                        placeholder="Reason for rejection (required)"
                        rows={3}
                        className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="danger"
                          disabled={rejectComment.trim().length < 5}
                          loading={rejectMutation.isPending}
                          onClick={() =>
                            rejectMutation.mutate({
                              instanceId: selected.instanceId,
                              nodeId: selected.nodeId,
                              comment: rejectComment.trim(),
                            })
                          }
                        >
                          Confirm Reject
                        </Button>
                        <Button variant="secondary" onClick={() => setShowReject(false)}>
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        loading={approveMutation.isPending}
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Approve this item?',
                            message: `"${selected.nodeName}" will be approved and unblocked to proceed.`,
                            confirmLabel: 'Approve',
                            variant: 'primary',
                          });
                          if (ok)
                            approveMutation.mutate({
                              instanceId: selected.instanceId,
                              nodeId: selected.nodeId,
                            });
                        }}
                      >
                        Approve
                      </Button>
                      <Button variant="danger" onClick={() => setShowReject(true)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
