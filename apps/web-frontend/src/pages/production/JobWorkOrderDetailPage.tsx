import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface MaterialLine {
  id: number;
  itemId: number;
  itemName?: string;
  requiredQty: string;
  issuedQty: string;
  unitCost: string;
  totalCost: string;
}

interface HistoryEntry {
  id: number;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  performedBy: number;
  createdAt: string;
}

interface OrderDetail {
  id: number;
  orderNumber: string;
  status: string;
  supplierId: number;
  supplierName?: string;
  outputItemId: number;
  outputItemName?: string;
  orderedQty: string;
  receivedQty: string;
  rejectedQty: string;
  scrapQty: string;
  jobWorkRate: string;
  jobWorkCharges: string;
  materialsCost: string;
  orderDate: string;
  expectedDate?: string;
  notes?: string;
  materials: MaterialLine[];
  history: HistoryEntry[];
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'default',
  MATERIAL_ISSUED: 'info',
  IN_PROGRESS: 'warning',
  QUALITY_CHECK: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

export default function JobWorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { data, isLoading } = useQuery({
    queryKey: ['job-work-order', id],
    queryFn: () => productionApi.getJobWorkOrder(Number(id)),
    enabled: !!id,
  });
  const order = data as OrderDetail | undefined;

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['job-work-order', id] });
    void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    void qc.invalidateQueries({ queryKey: ['job-work-dashboard'] });
  }

  const issueMaterialsMutation = useMutation({
    mutationFn: () => productionApi.issueMaterials(Number(id)),
    onSuccess: () => {
      toast.success('Materials issued to supplier');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startQcMutation = useMutation({
    mutationFn: () => productionApi.startQualityCheck(Number(id)),
    onSuccess: () => {
      toast.success('Quality check started');
      invalidate();
      navigate(`/production/job-work/${id}/qc`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) =>
      productionApi.cancelJobWorkOrder(Number(id), { cancellationReason: reason }),
    onSuccess: () => {
      toast.success('Order cancelled');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!order) return <ERPEmptyState type="no-data" title="Job work order not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={order.orderNumber}
        entityType="Job Work Order"
        entityNumber={order.orderNumber}
        status={order.status}
        backTo="/production/job-work"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_VARIANT[order.status] ?? 'default'}>
            {order.status.replace(/_/g, ' ')}
          </Badge>
          {hasPermission(PERMISSIONS.JOB_WORK_ISSUE_MATERIALS) && order.status === 'DRAFT' && (
            <Button
              isLoading={issueMaterialsMutation.isPending}
              onClick={() => issueMaterialsMutation.mutate()}
            >
              Issue Materials
            </Button>
          )}
          {hasPermission(PERMISSIONS.JOB_WORK_QUALITY_CHECK) &&
            ['MATERIAL_ISSUED', 'IN_PROGRESS'].includes(order.status) && (
              <Button
                isLoading={startQcMutation.isPending}
                onClick={() => startQcMutation.mutate()}
              >
                Start Quality Check
              </Button>
            )}
          {hasPermission(PERMISSIONS.JOB_WORK_QUALITY_CHECK) &&
            order.status === 'QUALITY_CHECK' && (
              <Button onClick={() => navigate(`/production/job-work/${id}/qc`)}>
                Quality Check / Complete
              </Button>
            )}
          {hasPermission(PERMISSIONS.JOB_WORK_CANCEL) &&
            !['COMPLETED', 'CANCELLED'].includes(order.status) && (
              <Button
                variant="danger-outline"
                onClick={() => {
                  const reason = prompt('Cancellation reason:');
                  if (reason) cancelMutation.mutate(reason);
                }}
              >
                Cancel
              </Button>
            )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supplier', value: order.supplierName ?? `ID: ${order.supplierId}` },
          { label: 'Output Item', value: order.outputItemName ?? `ID: ${order.outputItemId}` },
          { label: 'Ordered / Received Qty', value: `${order.orderedQty} / ${order.receivedQty}` },
          {
            label: 'Expected Completion',
            value: order.expectedDate ? formatDate(order.expectedDate) : '—',
          },
          { label: 'Job Work Rate', value: formatCurrency(parseFloat(order.jobWorkRate)) },
          { label: 'Job Work Charges', value: formatCurrency(parseFloat(order.jobWorkCharges)) },
          { label: 'Materials Cost', value: formatCurrency(parseFloat(order.materialsCost)) },
          { label: 'Order Date', value: formatDate(order.orderDate) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card border border-default rounded-xl p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-base font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3 text-sm">Materials</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Required Qty</th>
                <th className="pb-2 text-right">Issued Qty</th>
                <th className="pb-2 text-right">Unit Cost</th>
                <th className="pb-2 text-right">Total Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {order.materials.map((m) => (
                <tr key={m.id}>
                  <td className="py-2">{m.itemName ?? `Item ${m.itemId}`}</td>
                  <td className="py-2 text-right font-mono">
                    {parseFloat(m.requiredQty).toFixed(3)}
                  </td>
                  <td className="py-2 text-right font-mono">
                    {parseFloat(m.issuedQty).toFixed(3)}
                  </td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(m.unitCost))}</td>
                  <td className="py-2 text-right font-semibold">
                    {formatCurrency(parseFloat(m.totalCost))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.notes && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-1 text-sm">Notes</h3>
          <p className="text-sm text-secondary">{order.notes}</p>
        </div>
      )}

      {order.history.length > 0 && (
        <div className="bg-surface-card border border-default rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-sm">History</h3>
          <div className="space-y-2">
            {order.history.map((h) => (
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
                <span className="text-xs text-secondary">{formatDate(h.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
