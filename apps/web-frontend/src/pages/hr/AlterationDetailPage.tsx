import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { alterationApi, employeeApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import Modal from '../../components/ui/Modal.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

interface AlterationOrder {
  id: number;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  receivedDate: string;
  promisedDate: string;
  items: Array<{ description: string; quantity: number; rate: number; amount: number }>;
  totalAmount: string;
  advanceAmount: string;
  balanceDue: string;
  assignedToId?: number;
  status: string;
}

interface Employee { id: number; displayName: string; }

const NEXT_STATUS: Record<string, string[]> = {
  RECEIVED: ['CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['QUALITY_CHECK', 'CANCELLED'],
  QUALITY_CHECK: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  READY: ['CANCELLED'],
};

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  RECEIVED: 'default', ASSIGNED: 'info', IN_PROGRESS: 'warning', QUALITY_CHECK: 'warning',
  READY: 'success', DELIVERED: 'success', CANCELLED: 'danger',
};

export default function AlterationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [tailorId, setTailorId] = useState('');
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);

  const { data, isLoading } = useQuery({ queryKey: ['alterations', id], queryFn: () => alterationApi.getById(Number(id)) });
  const order = ((data as Record<string, unknown>)?.data as AlterationOrder) ?? (data as unknown as AlterationOrder);

  const { data: empData } = useQuery({ queryKey: ['employees-all'], queryFn: () => employeeApi.list() });
  const employees: Employee[] = ((empData as Record<string, unknown>)?.content as Employee[]) ?? [];

  const assignMutation = useMutation({
    mutationFn: () => alterationApi.assign(Number(id), { tailorId: Number(tailorId) }),
    onSuccess: () => { toast.success('Assigned to tailor'); qc.invalidateQueries({ queryKey: ['alterations', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => alterationApi.updateStatus(Number(id), { status }),
    onSuccess: () => { toast.success('Status updated'); qc.invalidateQueries({ queryKey: ['alterations', id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deliverMutation = useMutation({
    mutationFn: () => alterationApi.deliver(Number(id), { paymentAmount }),
    onSuccess: () => { toast.success('Order delivered'); qc.invalidateQueries({ queryKey: ['alterations', id] }); setDeliverOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !order) return <div className="p-8 text-center text-secondary">Loading…</div>;

  const tailorName = employees.find((e) => e.id === order.assignedToId)?.displayName;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={order.orderNumber}
        subtitle={order.customerName}
        backTo="/hr/alterations"
        status={order.status.replace('_', ' ')}
        statusVariant={STATUS_VARIANT[order.status] ?? 'default'}
      />

      <div className="grid grid-cols-2 gap-6 mt-6">
        <div className="bg-surface-card rounded-xl border border-default p-5">
          <h3 className="font-semibold text-primary mb-4">Order Details</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-secondary">Customer</dt><dd>{order.customerName}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Phone</dt><dd>{order.customerPhone}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Received</dt><dd>{formatDate(order.receivedDate)}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Promised</dt><dd>{formatDate(order.promisedDate)}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Assigned Tailor</dt><dd>{tailorName ?? '–'}</dd></div>
          </dl>

          <h4 className="font-medium text-primary mt-4 mb-2">Items</h4>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-default">
              {order.items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-1.5">{item.description}</td>
                  <td className="py-1.5 text-right">{item.quantity} × {formatCurrency(item.rate)}</td>
                  <td className="py-1.5 text-right font-mono">{formatCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-3 space-y-1 text-sm border-t border-default pt-3">
            <div className="flex justify-between"><dt className="text-secondary">Total</dt><dd className="font-mono">{formatCurrency(Number(order.totalAmount))}</dd></div>
            <div className="flex justify-between"><dt className="text-secondary">Advance</dt><dd className="font-mono">{formatCurrency(Number(order.advanceAmount))}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Balance Due</dt><dd className="font-mono">{formatCurrency(Number(order.balanceDue))}</dd></div>
          </dl>
        </div>

        <div className="space-y-6">
          {hasPermission(PERMISSIONS.ALTERATION_UPDATE) && order.status === 'RECEIVED' && (
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h3 className="font-semibold text-primary mb-3">Assign Tailor</h3>
              <Select value={tailorId} onChange={(e) => setTailorId(e.target.value)} className="mb-3">
                <option value="">Select tailor…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
              </Select>
              <Button onClick={() => assignMutation.mutate()} loading={assignMutation.isPending} disabled={!tailorId}>Assign</Button>
            </div>
          )}

          {hasPermission(PERMISSIONS.ALTERATION_UPDATE) && (NEXT_STATUS[order.status]?.length ?? 0) > 0 && (
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h3 className="font-semibold text-primary mb-3">Update Status</h3>
              <div className="flex gap-2 flex-wrap">
                {NEXT_STATUS[order.status]?.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === 'CANCELLED' ? 'danger-outline' : 'secondary'}
                    onClick={() => statusMutation.mutate(s)}
                    loading={statusMutation.isPending}
                  >
                    {s.replace('_', ' ')}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {hasPermission(PERMISSIONS.ALTERATION_UPDATE) && order.status === 'READY' && (
            <div className="bg-surface-card rounded-xl border border-default p-5">
              <h3 className="font-semibold text-primary mb-3">Delivery</h3>
              <p className="text-sm text-secondary mb-3">Balance due: <span className="font-mono font-semibold">{formatCurrency(Number(order.balanceDue))}</span></p>
              <Button onClick={() => { setPaymentAmount(Number(order.balanceDue)); setDeliverOpen(true); }}>Collect Payment & Deliver</Button>
            </div>
          )}
        </div>
      </div>

      <Modal open={deliverOpen} onClose={() => setDeliverOpen(false)} title="Collect Payment" size="sm">
        <div className="space-y-4">
          <Input label="Payment Amount (₹)" type="number" value={paymentAmount} onChange={(e) => setPaymentAmount(Number(e.target.value))} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeliverOpen(false)}>Cancel</Button>
            <Button onClick={() => deliverMutation.mutate()} loading={deliverMutation.isPending}>Confirm Delivery</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
