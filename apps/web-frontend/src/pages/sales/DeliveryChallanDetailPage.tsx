import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { deliveryChallanApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface ChallanLine {
  id: number;
  itemId: number;
  description?: string;
  quantity: string;
  unitPrice: string | null;
  hsnCode?: string;
}

interface ChallanDetail {
  id: number;
  challanNumber: string;
  customerId: number;
  branchId: number;
  warehouseId: number;
  status: string;
  challanDate: string;
  subtotal: string;
  notes?: string;
  convertedInvoiceId?: number;
  lines: ChallanLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  DISPATCHED: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'danger',
};

export default function DeliveryChallanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreateChallan = useAuthStore((s) => s.hasPermission(PERMISSIONS.INVOICE_CREATE));

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-challan', id],
    queryFn: () => deliveryChallanApi.getById(Number(id)),
    enabled: !!id,
  });

  const c = data as ChallanDetail;

  const dispatchMutation = useMutation({
    mutationFn: () => deliveryChallanApi.dispatch(Number(id)),
    onSuccess: () => {
      toast.success('Challan dispatched');
      void qc.invalidateQueries({ queryKey: ['delivery-challan', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: () => deliveryChallanApi.convertToInvoice(Number(id)),
    onSuccess: () => {
      toast.success('Ready to create invoice');
      navigate(`/sales/invoices/new?challanId=${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!c) return <ERPEmptyState type="no-data" title="Delivery challan not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={c.challanNumber}
        entityType="Delivery Challan"
        entityNumber={c.challanNumber}
        status={c.status}
        statusVariant={STATUS_COLORS[c.status] ?? 'default'}
        backTo="/sales/delivery-challans"
      >
        <div className="flex items-center gap-3">
          {canCreateChallan && c.status === 'DRAFT' && (
            <Button variant="ghost" isLoading={dispatchMutation.isPending} onClick={() => dispatchMutation.mutate()}>
              Dispatch
            </Button>
          )}
          {canCreateChallan && ['DRAFT', 'DISPATCHED'].includes(c.status) && (
            <Button isLoading={convertMutation.isPending} onClick={() => convertMutation.mutate()}>
              Convert to Invoice
            </Button>
          )}
          {c.convertedInvoiceId && (
            <Button variant="ghost" onClick={() => navigate(`/sales/invoices/${c.convertedInvoiceId}`)}>
              View Invoice
            </Button>
          )}
        </div>
      </ERPPageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Customer', value: `ID: ${c.customerId}` },
          { label: 'Challan Date', value: formatDate(c.challanDate) },
          { label: 'Subtotal', value: formatCurrency(parseFloat(c.subtotal)) },
          { label: 'Warehouse', value: `ID: ${c.warehouseId}` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card border border-default rounded-xl p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-base font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Line items */}
      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3 text-sm">Line Items</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary border-b border-default">
              <th className="pb-2">Item</th>
              <th className="pb-2">HSN</th>
              <th className="pb-2">Qty</th>
              <th className="pb-2">Unit Price</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {c.lines.map((l) => {
              const qty = parseFloat(l.quantity);
              const price = l.unitPrice ? parseFloat(l.unitPrice) : 0;
              return (
                <tr key={l.id}>
                  <td className="py-2">{l.description ?? `Item ${l.itemId}`}</td>
                  <td className="py-2 text-secondary">{l.hsnCode ?? '—'}</td>
                  <td className="py-2">{qty.toFixed(3)}</td>
                  <td className="py-2">{formatCurrency(price)}</td>
                  <td className="py-2 text-right font-semibold">{formatCurrency(qty * price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 pt-4 border-t border-default flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between font-bold text-base">
              <span>Subtotal</span>
              <span>{formatCurrency(parseFloat(c.subtotal))}</span>
            </div>
          </div>
        </div>
      </div>

      {c.notes && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
          <h3 className="font-semibold mb-1 text-sm">Notes</h3>
          <p className="text-sm text-secondary">{c.notes}</p>
        </div>
      )}
    </div>
  );
}
