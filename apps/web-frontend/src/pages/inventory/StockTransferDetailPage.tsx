import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { stockTransferApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import { formatDatetime } from '../../lib/format.js';

interface TransferLine {
  id: number;
  itemId: number;
  itemName?: string;
  requestedQty: string;
  dispatchedQty: string;
  receivedQty: string;
  unitCost?: string;
}

interface TransferDetail {
  id: number;
  transferNumber: string;
  fromWarehouseId: number;
  fromWarehouseName?: string;
  toWarehouseId: number;
  toWarehouseName?: string;
  status: string;
  notes?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  cancellationReason?: string;
  lines: TransferLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'warning',
  DISPATCHED: 'warning',
  IN_TRANSIT: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

export default function StockTransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage =
    hasPermission(PERMISSIONS.STOCK_TRANSFER) || hasPermission(PERMISSIONS.WAREHOUSE_MANAGE);
  const [receiveQty, setReceiveQty] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfer', id],
    queryFn: () => stockTransferApi.getById(Number(id)),
    enabled: !!id,
  });

  const transfer = data as TransferDetail | undefined;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['stock-transfer', id] });
  }

  const submitMutation = useMutation({
    mutationFn: () => stockTransferApi.submit(Number(id)),
    onSuccess: () => {
      toast.success('Transfer submitted');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => stockTransferApi.approve(Number(id)),
    onSuccess: () => {
      toast.success('Transfer approved');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatchMutation = useMutation({
    mutationFn: () => stockTransferApi.dispatch(Number(id)),
    onSuccess: () => {
      toast.success('Transfer dispatched — stock deducted from source warehouse');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const receiveMutation = useMutation({
    mutationFn: (lines: Array<{ lineId: number; receivedQty: number }>) =>
      stockTransferApi.receive(Number(id), lines),
    onSuccess: () => {
      toast.success('Transfer received — stock added to destination warehouse');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => stockTransferApi.cancel(Number(id), reason),
    onSuccess: () => {
      toast.success('Transfer cancelled');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!transfer) return <ERPEmptyState type="no-data" title="Stock transfer not found" />;

  const canReceive = transfer.status === 'DISPATCHED' || transfer.status === 'IN_TRANSIT';
  const canCancel = !['RECEIVED', 'CANCELLED'].includes(transfer.status);

  function handleReceive() {
    const lines = (transfer as TransferDetail).lines.map((l) => ({
      lineId: l.id,
      receivedQty: parseFloat(receiveQty[l.id] ?? l.requestedQty),
    }));
    receiveMutation.mutate(lines);
  }

  function handleCancel() {
    const reason = window.prompt('Reason for cancelling this transfer:');
    if (reason && reason.trim()) cancelMutation.mutate(reason.trim());
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={transfer.transferNumber}
        entityType="Stock Transfer"
        entityNumber={transfer.transferNumber}
        status={transfer.status}
        backTo="/inventory/transfers"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[transfer.status] ?? 'default'}>{transfer.status}</Badge>
          {canManage && transfer.status === 'DRAFT' && (
            <Button onClick={() => submitMutation.mutate()} isLoading={submitMutation.isPending}>
              Submit
            </Button>
          )}
          {canManage && transfer.status === 'SUBMITTED' && (
            <Button onClick={() => approveMutation.mutate()} isLoading={approveMutation.isPending}>
              Approve
            </Button>
          )}
          {canManage && transfer.status === 'APPROVED' && (
            <Button
              onClick={() => dispatchMutation.mutate()}
              isLoading={dispatchMutation.isPending}
            >
              Dispatch
            </Button>
          )}
          {canManage && canReceive && (
            <Button onClick={handleReceive} isLoading={receiveMutation.isPending}>
              Receive
            </Button>
          )}
          {canManage && canCancel && (
            <Button variant="danger" onClick={handleCancel} isLoading={cancelMutation.isPending}>
              Cancel
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'From Warehouse',
            value: transfer.fromWarehouseName ?? `#${transfer.fromWarehouseId}`,
          },
          {
            label: 'To Warehouse',
            value: transfer.toWarehouseName ?? `#${transfer.toWarehouseId}`,
          },
          {
            label: 'Dispatched',
            value: transfer.dispatchedAt ? formatDatetime(transfer.dispatchedAt) : '—',
          },
          {
            label: 'Received',
            value: transfer.receivedAt ? formatDatetime(transfer.receivedAt) : '—',
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {transfer.status === 'CANCELLED' && transfer.cancellationReason && (
        <div className="bg-surface-card border border-danger/40 rounded-xl p-4 mb-4 text-sm">
          <span className="font-medium text-danger">Cancellation reason: </span>
          {transfer.cancellationReason}
        </div>
      )}

      <div className="bg-surface-card border border-default rounded-xl p-4">
        <h3 className="font-semibold mb-3">Line Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Requested Qty</th>
                <th className="pb-2 text-right">Dispatched Qty</th>
                <th className="pb-2 text-right">
                  {canReceive ? 'Received Qty (editable)' : 'Received Qty'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {transfer.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.itemName ?? `Item ${l.itemId}`}</td>
                  <td className="py-2 text-right">{parseFloat(l.requestedQty).toFixed(3)}</td>
                  <td className="py-2 text-right">{parseFloat(l.dispatchedQty).toFixed(3)}</td>
                  <td className="py-2 text-right">
                    {canReceive ? (
                      <Input
                        type="number"
                        step="0.001"
                        className="w-28 text-right ml-auto"
                        value={receiveQty[l.id] ?? l.requestedQty}
                        onChange={(e) =>
                          setReceiveQty((prev) => ({ ...prev, [l.id]: e.target.value }))
                        }
                      />
                    ) : (
                      parseFloat(l.receivedQty).toFixed(3)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {transfer.notes && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mt-4 text-sm text-secondary">
          <span className="font-medium text-primary">Notes: </span>
          {transfer.notes}
        </div>
      )}
    </div>
  );
}
