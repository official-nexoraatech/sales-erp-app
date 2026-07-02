import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { alterationApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

interface AlterationOrder {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  promisedDate: string;
  totalAmount: string;
  balanceDue: string;
  status: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  RECEIVED: 'default',
  ASSIGNED: 'info',
  IN_PROGRESS: 'warning',
  QUALITY_CHECK: 'warning',
  READY: 'success',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

const STATUSES = ['RECEIVED', 'ASSIGNED', 'IN_PROGRESS', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'CANCELLED'];

export default function AlterationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['alterations', statusFilter],
    queryFn: () => alterationApi.list({ status: statusFilter || undefined }),
  });
  const orders: AlterationOrder[] = ((data as Record<string, unknown>)?.content as AlterationOrder[]) ?? [];

  const { data: overdueData } = useQuery({ queryKey: ['alterations-overdue'], queryFn: () => alterationApi.overdue() });
  const overdueCount = ((overdueData as Record<string, unknown>)?.content as unknown[])?.length ?? 0;

  const cancelMutation = useMutation({
    mutationFn: (id: number) => alterationApi.updateStatus(id, { status: 'CANCELLED' }),
    onSuccess: () => { toast.success('Order cancelled'); qc.invalidateQueries({ queryKey: ['alterations'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Alteration Orders"
        subtitle={overdueCount > 0 ? `${overdueCount} order(s) overdue` : 'Receive, assign, and track alteration work.'}
        actions={
          hasPermission(PERMISSIONS.ALTERATION_CREATE) ? (
            <Button onClick={() => navigate('/hr/alterations/new')}>+ Receive Order</Button>
          ) : undefined
        }
      />

      <div className="mb-4">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-xs">
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-disabled text-sm">No alteration orders found.</p>
      ) : (
        <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
          <thead className="bg-surface-subtle">
            <tr className="text-left text-xs uppercase text-secondary">
              <th className="px-4 py-3">Order #</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Promised Date</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Balance Due</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-surface-subtle cursor-pointer" onClick={() => navigate(`/hr/alterations/${o.id}`)}>
                <td className="px-4 py-3 font-mono text-xs">{o.orderNumber}</td>
                <td className="px-4 py-3">
                  <p className="font-medium">{o.customerName}</p>
                  <p className="text-xs text-secondary">{o.customerPhone}</p>
                </td>
                <td className="px-4 py-3 text-xs">{formatDate(o.promisedDate)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(o.totalAmount))}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(o.balanceDue))}</td>
                <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[o.status] ?? 'default'}>{o.status.replace('_', ' ')}</Badge></td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  {hasPermission(PERMISSIONS.ALTERATION_UPDATE) && o.status !== 'DELIVERED' && o.status !== 'CANCELLED' && (
                    <Button size="sm" variant="danger-outline" onClick={() => cancelMutation.mutate(o.id)}>Cancel</Button>
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
