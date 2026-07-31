import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { stockAdjustmentApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatCurrency } from '../../lib/format.js';

interface AdjustmentLine {
  id: number;
  itemId: number;
  itemName?: string;
  direction: 'IN' | 'OUT';
  quantity: string;
  systemQty: string;
  unitCost?: string;
  lineValue: string;
  reason?: string;
}

interface AdjustmentDetail {
  id: number;
  adjustmentNumber: string;
  warehouseId: number;
  warehouseName?: string;
  adjustmentType: string;
  status: string;
  totalValue: string;
  notes?: string;
  cancellationReason?: string;
  lines: AdjustmentLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  CANCELLED: 'danger',
};

export default function StockAdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage =
    hasPermission(PERMISSIONS.STOCK_ADJUST) || hasPermission(PERMISSIONS.WAREHOUSE_MANAGE);
  const [showCancelReason, setShowCancelReason] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stock-adjustment', id],
    queryFn: () => stockAdjustmentApi.getById(Number(id)),
    enabled: !!id,
  });

  const adjustment = data as AdjustmentDetail | undefined;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['stock-adjustment', id] });
    qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
  }

  const submitMutation = useMutation({
    mutationFn: () => stockAdjustmentApi.submit(Number(id)),
    onSuccess: () => {
      toast.success('Adjustment submitted');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => stockAdjustmentApi.approve(Number(id)),
    onSuccess: () => {
      toast.success('Adjustment approved — stock updated');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => stockAdjustmentApi.cancel(Number(id), reason),
    onSuccess: () => {
      toast.success('Adjustment cancelled');
      setShowCancelReason(false);
      setCancelReason('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!adjustment) return <ERPEmptyState type="no-data" title="Stock adjustment not found" />;

  const canCancel = !['APPROVED', 'CANCELLED'].includes(adjustment.status);

  function handleCancel() {
    if (cancelReason.trim()) cancelMutation.mutate(cancelReason.trim());
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={adjustment.adjustmentNumber}
        entityType="Stock Adjustment"
        entityNumber={adjustment.adjustmentNumber}
        status={adjustment.status}
        backTo="/inventory/adjustments"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[adjustment.status] ?? 'default'}>{adjustment.status}</Badge>
          {canManage && adjustment.status === 'DRAFT' && (
            <Button onClick={() => submitMutation.mutate()} isLoading={submitMutation.isPending}>
              Submit
            </Button>
          )}
          {canManage &&
            (adjustment.status === 'SUBMITTED' || adjustment.status === 'PENDING_APPROVAL') && (
              <Button
                onClick={() => approveMutation.mutate()}
                isLoading={approveMutation.isPending}
              >
                Approve
              </Button>
            )}
          {canManage && canCancel && (
            <Button
              variant="danger"
              onClick={() => setShowCancelReason(true)}
              isLoading={cancelMutation.isPending}
            >
              Cancel
            </Button>
          )}
        </div>
      </ERPPageHeader>

      {showCancelReason && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <label className="block text-sm font-medium mb-2" htmlFor="cancel-reason">
            Reason for cancelling this adjustment
          </label>
          <textarea
            id="cancel-reason"
            className="w-full rounded-lg border border-default bg-surface-base px-3 py-2 text-sm"
            rows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <Button
              variant="danger"
              onClick={handleCancel}
              isLoading={cancelMutation.isPending}
              disabled={!cancelReason.trim()}
            >
              Confirm Cancel
            </Button>
            <Button variant="ghost" onClick={() => setShowCancelReason(false)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Warehouse', value: adjustment.warehouseName ?? `#${adjustment.warehouseId}` },
          { label: 'Type', value: adjustment.adjustmentType },
          { label: 'Total Value', value: formatCurrency(parseFloat(adjustment.totalValue)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {adjustment.status === 'CANCELLED' && adjustment.cancellationReason && (
        <div className="bg-surface-card border border-danger/40 rounded-xl p-4 mb-4 text-sm">
          <span className="font-medium text-danger">Cancellation reason: </span>
          {adjustment.cancellationReason}
        </div>
      )}

      <div className="bg-surface-card border border-default rounded-xl p-4">
        <h3 className="font-semibold mb-3">Line Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Item</th>
                <th className="pb-2">Direction</th>
                <th className="pb-2 text-right">Quantity</th>
                <th className="pb-2 text-right">System Qty</th>
                <th className="pb-2 text-right">Value</th>
                <th className="pb-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {adjustment.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.itemName ?? `Item ${l.itemId}`}</td>
                  <td className="py-2">
                    <Badge variant={l.direction === 'IN' ? 'success' : 'danger'}>
                      {l.direction}
                    </Badge>
                  </td>
                  <td className="py-2 text-right">{parseFloat(l.quantity).toFixed(3)}</td>
                  <td className="py-2 text-right">{parseFloat(l.systemQty).toFixed(3)}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(l.lineValue))}</td>
                  <td className="py-2">{l.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adjustment.notes && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mt-4 text-sm text-secondary">
          <span className="font-medium text-primary">Notes: </span>
          {adjustment.notes}
        </div>
      )}

      {adjustment.status === 'APPROVED' && (
        <div className="text-xs text-secondary mt-3">
          Approved — stock quantities updated for every line above. This does not recompute average
          cost.
        </div>
      )}
    </div>
  );
}
