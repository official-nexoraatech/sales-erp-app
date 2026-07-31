import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierPaymentApi, grnApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Allocation {
  id: number;
  grnId: number;
  grnNumber?: string | null;
  amount: string;
  createdAt: string;
}

interface SupplierPaymentDetail {
  id: number;
  paymentNumber: string;
  supplierId: number;
  supplierName?: string;
  paymentDate: string;
  paymentMode: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  status: string;
  chequeNumber?: string | null;
  chequeBankName?: string | null;
  isPdc: boolean;
  pdcClearingDate?: string | null;
  transactionReference?: string | null;
  notes?: string | null;
  bounceReason?: string | null;
  allocations: Allocation[];
}

interface GRNOption {
  id: number;
  grnNumber: string | null;
  grandTotal: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  PAID: 'warning',
  PARTIALLY_ALLOCATED: 'warning',
  FULLY_ALLOCATED: 'success',
  BOUNCED: 'danger',
  CANCELLED: 'danger',
};

function openPdfInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoke after the new tab has had time to load the object URL, not immediately.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function SupplierPaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAllocate = hasPermission(PERMISSIONS.PAYMENT_OUT_CREATE);

  const [allocateOpen, setAllocateOpen] = useState(false);
  const [allocAmounts, setAllocAmounts] = useState<Record<number, string>>({});
  const [bounceOpen, setBounceOpen] = useState(false);
  const [bounceReason, setBounceReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payment-detail', id],
    queryFn: () => supplierPaymentApi.getById(Number(id)),
    enabled: !!id,
  });

  const payment = data as SupplierPaymentDetail | undefined;

  const { data: grnData } = useQuery({
    queryKey: ['grns-for-allocation', payment?.supplierId],
    queryFn: () => grnApi.list({ status: 'APPROVED', pageSize: 100 } as never).then((r) => r),
    enabled: allocateOpen && !!payment,
  });
  const grnOptions: GRNOption[] = (
    ((grnData as Record<string, unknown>)?.content as (GRNOption & { supplierId: number })[]) ?? []
  ).filter((g) => g.supplierId === payment?.supplierId);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['supplier-payment-detail', id] });
  }

  const allocateMutation = useMutation({
    mutationFn: (allocations: { grnId: number; amount: number }[]) =>
      supplierPaymentApi.allocate(Number(id), { allocations }),
    onSuccess: () => {
      toast.success('Payment allocated');
      setAllocateOpen(false);
      setAllocAmounts({});
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: (reason: string) => supplierPaymentApi.bounce(Number(id), { reason }),
    onSuccess: () => {
      toast.success('Cheque marked bounced');
      setBounceOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const voucherMutation = useMutation({
    mutationFn: () => supplierPaymentApi.voucher(Number(id)),
    onSuccess: (blob) => openPdfInNewTab(blob as Blob),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!payment) return <ERPEmptyState type="no-data" title="Supplier payment not found" />;

  const allocationTotal = Object.values(allocAmounts).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={payment.paymentNumber}
        entityType="Supplier Payment"
        entityNumber={payment.paymentNumber}
        status={payment.status}
        backTo="/purchase/payments"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[payment.status] ?? 'default'}>
            {payment.status.replace(/_/g, ' ')}
          </Badge>
          {canAllocate &&
            parseFloat(payment.unallocatedAmount) > 0 &&
            payment.status !== 'BOUNCED' && (
              <Button onClick={() => setAllocateOpen(true)}>Allocate to GRN</Button>
            )}
          <Button
            variant="ghost"
            onClick={() => voucherMutation.mutate()}
            isLoading={voucherMutation.isPending}
          >
            Print Voucher
          </Button>
          {canAllocate && payment.paymentMode === 'CHEQUE' && payment.status !== 'BOUNCED' && (
            <Button variant="danger" onClick={() => setBounceOpen(true)}>
              Mark Bounced
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supplier', value: payment.supplierName ?? `Supplier ${payment.supplierId}` },
          { label: 'Payment Date', value: formatDate(payment.paymentDate) },
          { label: 'Mode', value: payment.paymentMode + (payment.isPdc ? ' (PDC)' : '') },
          { label: 'Amount', value: formatCurrency(parseFloat(payment.amount)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="bg-surface-card rounded-xl border border-default p-4 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-secondary">Allocated</span>
            <span>{formatCurrency(parseFloat(payment.allocatedAmount))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-secondary">Unallocated</span>
            <span>{formatCurrency(parseFloat(payment.unallocatedAmount))}</span>
          </div>
          {payment.transactionReference && (
            <div className="flex justify-between">
              <span className="text-secondary">Reference</span>
              <span>{payment.transactionReference}</span>
            </div>
          )}
          {payment.chequeNumber && (
            <div className="flex justify-between">
              <span className="text-secondary">Cheque #</span>
              <span>
                {payment.chequeNumber} {payment.chequeBankName ? `· ${payment.chequeBankName}` : ''}
              </span>
            </div>
          )}
          {payment.isPdc && payment.pdcClearingDate && (
            <div className="flex justify-between">
              <span className="text-secondary">PDC Clearing Date</span>
              <span>{formatDate(payment.pdcClearingDate)}</span>
            </div>
          )}
          {payment.bounceReason && (
            <div className="flex justify-between">
              <span className="text-danger">Bounce Reason</span>
              <span>{payment.bounceReason}</span>
            </div>
          )}
          {payment.notes && (
            <div className="flex justify-between">
              <span className="text-secondary">Notes</span>
              <span>{payment.notes}</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4">
        <h3 className="font-semibold mb-3">Allocations</h3>
        {payment.allocations.length === 0 ? (
          <p className="text-sm text-secondary">Not yet allocated to any GRN.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">GRN #</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {payment.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="py-2">{a.grnNumber ?? `GRN-${a.grnId}`}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(a.amount))}</td>
                  <td className="py-2 text-secondary">{formatDate(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        title="Allocate Payment to GRNs"
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Unallocated: {formatCurrency(parseFloat(payment.unallocatedAmount))}
          </p>
          {grnOptions.length === 0 ? (
            <p className="text-sm text-secondary">No approved GRNs found for this supplier.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {grnOptions.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">
                    {g.grnNumber ?? `GRN-${g.id}`}{' '}
                    <span className="text-secondary">
                      ({formatCurrency(parseFloat(g.grandTotal))})
                    </span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={allocAmounts[g.id] ?? ''}
                    onChange={(e) =>
                      setAllocAmounts((prev) => ({ ...prev, [g.id]: e.target.value }))
                    }
                    className="w-32 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-default">
            <Button variant="ghost" onClick={() => setAllocateOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={allocateMutation.isPending}
              disabled={
                allocationTotal <= 0 ||
                allocationTotal > parseFloat(payment.unallocatedAmount) + 0.001
              }
              onClick={() =>
                allocateMutation.mutate(
                  Object.entries(allocAmounts)
                    .filter(([, v]) => parseFloat(v) > 0)
                    .map(([grnId, v]) => ({ grnId: Number(grnId), amount: parseFloat(v) }))
                )
              }
            >
              Allocate {formatCurrency(allocationTotal)}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bounceOpen}
        onClose={() => setBounceOpen(false)}
        title="Mark Cheque as Bounced"
      >
        <div className="space-y-4">
          <Input
            label="Reason"
            required
            placeholder="Reason for bounce"
            value={bounceReason}
            onChange={(e) => setBounceReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setBounceOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={bounceMutation.isPending}
              disabled={!bounceReason.trim()}
              onClick={() => bounceMutation.mutate(bounceReason)}
            >
              Mark Bounced
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
