import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseReturnApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface ReturnLine {
  id: number;
  itemId: number;
  itemName?: string;
  returnQty: string;
  unitPrice: string;
  gstRate: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

interface DebitNote {
  id: number;
  debitNoteNumber: string;
  status: string;
  amount: string;
  appliedAmount: string;
  balanceAmount: string;
  issueDate: string;
}

interface PurchaseReturnDetail {
  id: number;
  returnNumber: string | null;
  status: string;
  supplierId: number;
  supplierName?: string;
  grnId: number;
  grnNumber?: string | null;
  returnDate: string;
  reason: string;
  returnNotes?: string | null;
  grandTotal: string;
  lines: ReturnLine[];
  debitNote: DebitNote | null;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  APPROVED: 'success',
  CANCELLED: 'danger',
};

const DN_STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'warning',
  PARTIALLY_APPLIED: 'default',
  APPLIED: 'success',
  CANCELLED: 'danger',
};

export default function PurchaseReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canApprove = hasPermission(PERMISSIONS.PURCHASE_RETURN_APPROVE);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyAmount, setApplyAmount] = useState('');
  const [applyNotes, setApplyNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-return-detail', id],
    queryFn: () => purchaseReturnApi.getById(Number(id)),
    enabled: !!id,
  });

  const ret = data as PurchaseReturnDetail | undefined;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['purchase-return-detail', id] });
  }

  const approveMutation = useMutation({
    mutationFn: () => purchaseReturnApi.approve(Number(id)),
    onSuccess: () => {
      toast.success('Purchase return approved — stock deducted, debit note created');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      purchaseReturnApi.applyDebitNote(ret!.debitNote!.id, {
        amount: parseFloat(applyAmount),
        ...(applyNotes ? { notes: applyNotes } : {}),
      }),
    onSuccess: () => {
      toast.success('Debit note applied');
      setApplyOpen(false);
      setApplyAmount('');
      setApplyNotes('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!ret) return <ERPEmptyState type="no-data" title="Purchase return not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={ret.returnNumber ?? `Return ${ret.id}`}
        entityType="Purchase Return"
        entityNumber={ret.returnNumber ?? `PR-${ret.id}`}
        status={ret.status}
        backTo="/purchase/returns"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[ret.status] ?? 'default'}>{ret.status}</Badge>
          {canApprove && ret.status === 'DRAFT' && (
            <Button
              isLoading={approveMutation.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Approve purchase return?',
                  message: `This will deduct the returned quantity from stock and generate a debit note against ${ret.supplierName ?? 'this supplier'}. This cannot be undone.`,
                  confirmLabel: 'Approve',
                  variant: 'primary',
                });
                if (ok) approveMutation.mutate();
              }}
            >
              Approve
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supplier', value: ret.supplierName ?? `Supplier ${ret.supplierId}` },
          { label: 'GRN #', value: ret.grnNumber ?? `GRN-${ret.grnId}` },
          { label: 'Return Date', value: formatDate(ret.returnDate) },
          { label: 'Grand Total', value: formatCurrency(parseFloat(ret.grandTotal)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4 text-sm">
        <span className="text-secondary">Reason: </span>
        <span className="text-primary">{ret.reason.replace(/_/g, ' ')}</span>
        {ret.returnNotes && (
          <>
            <span className="mx-3 text-disabled">·</span>
            <span className="text-secondary">Notes: </span>
            <span className="text-primary">{ret.returnNotes}</span>
          </>
        )}
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3">Line Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Item</th>
                <th className="pb-2 text-right">Return Qty</th>
                <th className="pb-2 text-right">Unit Price</th>
                <th className="pb-2 text-right">Taxable</th>
                <th className="pb-2 text-right">CGST</th>
                <th className="pb-2 text-right">SGST</th>
                <th className="pb-2 text-right">IGST</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {ret.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.itemName ?? `Item ${l.itemId}`}</td>
                  <td className="py-2 text-right">{parseFloat(l.returnQty).toFixed(3)}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(l.unitPrice))}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(l.taxableAmount))}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(l.cgstAmount))}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(l.sgstAmount))}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(l.igstAmount))}</td>
                  <td className="py-2 text-right font-medium">
                    {formatCurrency(parseFloat(l.lineTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {ret.debitNote && (
        <div className="bg-surface-card border border-default rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Debit Note</h3>
            {canApprove && ['OPEN', 'PARTIALLY_APPLIED'].includes(ret.debitNote.status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setApplyAmount(ret.debitNote!.balanceAmount);
                  setApplyNotes('');
                  setApplyOpen(true);
                }}
              >
                Apply
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-xs text-secondary">DN #</div>
              <div className="font-mono">{ret.debitNote.debitNoteNumber}</div>
            </div>
            <div>
              <div className="text-xs text-secondary">Amount</div>
              <div>{formatCurrency(parseFloat(ret.debitNote.amount))}</div>
            </div>
            <div>
              <div className="text-xs text-secondary">Balance</div>
              <div>{formatCurrency(parseFloat(ret.debitNote.balanceAmount))}</div>
            </div>
            <div>
              <div className="text-xs text-secondary">Status</div>
              <Badge variant={DN_STATUS_COLORS[ret.debitNote.status] ?? 'default'}>
                {ret.debitNote.status}
              </Badge>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={applyOpen} onClose={() => setApplyOpen(false)} title="Apply Debit Note">
        {ret.debitNote && (
          <div className="space-y-4">
            <Input
              label="Amount to Apply (₹)"
              type="number"
              step="0.01"
              min="0"
              max={ret.debitNote.balanceAmount}
              value={applyAmount}
              onChange={(e) => setApplyAmount(e.target.value)}
              required
            />
            <Input
              label="Notes"
              placeholder="e.g. Adjusted against Payment #123"
              value={applyNotes}
              onChange={(e) => setApplyNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setApplyOpen(false)}>
                Cancel
              </Button>
              <Button
                isLoading={applyMutation.isPending}
                disabled={!applyAmount || parseFloat(applyAmount) <= 0}
                onClick={() => applyMutation.mutate()}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
