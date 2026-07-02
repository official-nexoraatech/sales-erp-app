import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatDate } from '../../lib/format.js';

interface JobWorkOrder {
  id: number;
  orderNumber: string;
  status: string;
  supplierName?: string;
  outputItemName?: string;
  orderedQty: number;
  receivedQty: number;
  expectedDate: string;
  jobWorkCharges: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'default',
  MATERIAL_ISSUED: 'info',
  IN_PROGRESS: 'warning',
  QUALITY_CHECK: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const STATUSES = ['DRAFT', 'MATERIAL_ISSUED', 'IN_PROGRESS', 'QUALITY_CHECK', 'COMPLETED', 'CANCELLED'];

export default function JobWorkOrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['job-work-orders', statusFilter],
    queryFn: () => statusFilter ? productionApi.listJobWorkOrders({ status: statusFilter }) : productionApi.listJobWorkOrders(),
  });
  const orders: JobWorkOrder[] = ((data as Record<string, unknown>)?.data as JobWorkOrder[]) ?? [];

  const { data: dashData } = useQuery({
    queryKey: ['job-work-dashboard'],
    queryFn: () => productionApi.getJobWorkDashboard(),
  });
  const dash = (dashData as Record<string, unknown>)?.data as Record<string, number> | undefined;

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      productionApi.cancelJobWorkOrder(id, { cancellationReason: reason }),
    onSuccess: () => {
      toast.success('Order cancelled');
      qc.invalidateQueries({ queryKey: ['job-work-orders'] });
      qc.invalidateQueries({ queryKey: ['job-work-dashboard'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Job Work Orders"
        subtitle="Manage outsourced stitching and processing orders."
        actions={
          hasPermission(PERMISSIONS.JOB_WORK_CREATE) ? (
            <Button onClick={() => navigate('/production/job-work/new')}>+ New Job Work Order</Button>
          ) : undefined
        }
      />

      {dash && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-surface-card rounded-xl border border-default p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Pending</p>
            <p className="text-2xl font-bold text-primary">{dash.pending ?? 0}</p>
          </div>
          <div className="bg-surface-card rounded-xl border border-default p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Overdue</p>
            <p className="text-2xl font-bold text-danger">{dash.overdue ?? 0}</p>
          </div>
          <div className="bg-surface-card rounded-xl border border-default p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Completed Today</p>
            <p className="text-2xl font-bold text-success">{dash.completedToday ?? 0}</p>
          </div>
        </div>
      )}

      <div className="mb-4">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-disabled text-sm">No job work orders found.</p>
      ) : (
        <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
          <thead className="bg-surface-subtle">
            <tr className="text-left text-xs uppercase text-secondary">
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3 text-right">Ordered Qty</th>
              <th className="px-4 py-3 text-right">Received Qty</th>
              <th className="px-4 py-3">Expected Date</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {orders.map((o) => (
              <tr
                key={o.id}
                className="hover:bg-surface-subtle cursor-pointer"
                onClick={() => navigate(`/production/job-work/${o.id}`)}
              >
                <td className="px-4 py-3 font-mono text-xs">{o.orderNumber}</td>
                <td className="px-4 py-3">{o.supplierName ?? '—'}</td>
                <td className="px-4 py-3">{o.outputItemName ?? '—'}</td>
                <td className="px-4 py-3 text-right font-mono">{o.orderedQty}</td>
                <td className="px-4 py-3 text-right font-mono">{o.receivedQty}</td>
                <td className="px-4 py-3 text-xs">{formatDate(o.expectedDate)}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[o.status] ?? 'default'}>{o.status.replace(/_/g, ' ')}</Badge>
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  {hasPermission(PERMISSIONS.JOB_WORK_CANCEL) &&
                    !['COMPLETED', 'CANCELLED'].includes(o.status) && (
                      <Button
                        size="sm"
                        variant="danger-outline"
                        onClick={() => {
                          const reason = prompt('Cancellation reason:');
                          if (reason) cancelMutation.mutate({ id: o.id, reason });
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
