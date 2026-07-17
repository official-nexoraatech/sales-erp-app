import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseOrderApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import AttachmentSection from '../../components/erp/AttachmentSection.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface POLine {
  id: number;
  itemId: number;
  itemName?: string;
  hsnCode?: string;
  orderedQty: string;
  receivedQty: string;
  unitPrice: string;
  taxableAmount: string;
  gstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

interface PODetail {
  id: number;
  poNumber: string | null;
  status: string;
  supplierId: number;
  supplierName?: string;
  poDate: string;
  expectedDeliveryDate?: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  grandTotal: string;
  receivedAmount: string;
  notes?: string;
  termsAndConditions?: string;
  lines: POLine[];
}

interface ActivityEntry {
  id: number;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  performedBy: number;
  notes?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CLOSED: 'success',
  CANCELLED: 'danger',
};

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.PO_CREATE);
  const canApprove = hasPermission(PERMISSIONS.PO_APPROVE);
  const canCancel = hasPermission(PERMISSIONS.PO_CANCEL);

  const [approveOpen, setApproveOpen] = useState(false);
  const [poNumberInput, setPoNumberInput] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => purchaseOrderApi.getById(Number(id)),
    enabled: !!id,
  });

  const { data: activityData } = useQuery({
    queryKey: ['purchase-order-activity', id],
    queryFn: () => purchaseOrderApi.activity(Number(id)),
    enabled: !!id,
  });

  const po = data as PODetail | undefined;
  const activity = (activityData as ActivityEntry[] | undefined) ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['purchase-order', id] });
    qc.invalidateQueries({ queryKey: ['purchase-order-activity', id] });
  }

  const submitMutation = useMutation({
    mutationFn: () => purchaseOrderApi.submit(Number(id)),
    onSuccess: () => {
      toast.success('Purchase order submitted');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (poNumber: string) => purchaseOrderApi.approve(Number(id), { poNumber }),
    onSuccess: () => {
      toast.success('Purchase order approved');
      setApproveOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => purchaseOrderApi.cancel(Number(id), { reason }),
    onSuccess: () => {
      toast.success('Purchase order cancelled');
      setCancelOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => purchaseOrderApi.duplicate(Number(id)),
    onSuccess: (created) => {
      toast.success('Duplicated as a new draft');
      const newId = (created as { id?: number })?.id;
      if (newId) navigate(`/purchase/orders/${newId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!po) return <ERPEmptyState type="no-data" title="Purchase order not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={po.poNumber ?? 'Draft Purchase Order'}
        entityType="Purchase Order"
        entityNumber={po.poNumber ?? `Draft-${po.id}`}
        status={po.status}
        backTo="/purchase/orders"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[po.status] ?? 'default'}>{po.status}</Badge>
          {canCreate && po.status === 'DRAFT' && (
            <Button onClick={() => submitMutation.mutate()} isLoading={submitMutation.isPending}>
              Submit
            </Button>
          )}
          {canApprove && (po.status === 'SUBMITTED' || po.status === 'PENDING_APPROVAL') && (
            <Button onClick={() => setApproveOpen(true)}>Approve</Button>
          )}
          {canCreate && (
            <Button
              variant="ghost"
              onClick={() => duplicateMutation.mutate()}
              isLoading={duplicateMutation.isPending}
            >
              Duplicate
            </Button>
          )}
          {canCancel && !['RECEIVED', 'CLOSED', 'CANCELLED'].includes(po.status) && (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              Cancel
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supplier', value: po.supplierName ?? `Supplier ${po.supplierId}` },
          { label: 'PO Date', value: formatDate(po.poDate) },
          {
            label: 'Expected Delivery',
            value: po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : '—',
          },
          { label: 'Grand Total', value: formatCurrency(parseFloat(po.grandTotal)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Line Items */}
      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3">Line Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Item</th>
                <th className="pb-2">HSN</th>
                <th className="pb-2 text-right">Ordered</th>
                <th className="pb-2 text-right">Received</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Taxable</th>
                <th className="pb-2 text-right">CGST</th>
                <th className="pb-2 text-right">SGST</th>
                <th className="pb-2 text-right">IGST</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">{l.itemName ?? `Item ${l.itemId}`}</td>
                  <td className="py-2 text-secondary">{l.hsnCode ?? '—'}</td>
                  <td className="py-2 text-right">{parseFloat(l.orderedQty).toFixed(3)}</td>
                  <td className="py-2 text-right">{parseFloat(l.receivedQty).toFixed(3)}</td>
                  <td className="py-2 text-right">₹{parseFloat(l.unitPrice).toFixed(2)}</td>
                  <td className="py-2 text-right">₹{parseFloat(l.taxableAmount).toFixed(2)}</td>
                  <td className="py-2 text-right">₹{parseFloat(l.cgstAmount).toFixed(2)}</td>
                  <td className="py-2 text-right">₹{parseFloat(l.sgstAmount).toFixed(2)}</td>
                  <td className="py-2 text-right">₹{parseFloat(l.igstAmount).toFixed(2)}</td>
                  <td className="py-2 text-right font-medium">
                    ₹{parseFloat(l.lineTotal).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end mt-4 pt-4 border-t border-default">
          <div className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-secondary">Taxable Amount</span>
              <span>{formatCurrency(parseFloat(po.taxableAmount))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">CGST + SGST + IGST</span>
              <span>
                {formatCurrency(
                  parseFloat(po.cgstAmount) + parseFloat(po.sgstAmount) + parseFloat(po.igstAmount)
                )}
              </span>
            </div>
            <div className="flex justify-between font-semibold text-base pt-1 border-t border-default">
              <span>Grand Total</span>
              <span>{formatCurrency(parseFloat(po.grandTotal))}</span>
            </div>
            <div className="flex justify-between text-secondary">
              <span>Received Amount</span>
              <span>{formatCurrency(parseFloat(po.receivedAmount))}</span>
            </div>
          </div>
        </div>
      </div>

      {(po.notes || po.termsAndConditions) && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4 text-sm space-y-2">
          {po.notes && (
            <div>
              <span className="font-medium text-primary">Notes: </span>
              <span className="text-secondary">{po.notes}</span>
            </div>
          )}
          {po.termsAndConditions && (
            <div>
              <span className="font-medium text-primary">Terms &amp; Conditions: </span>
              <span className="text-secondary">{po.termsAndConditions}</span>
            </div>
          )}
        </div>
      )}

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3">History</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-secondary">No activity recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {activity.map((a) => (
              <li key={a.id} className="text-sm border-l-2 border-default pl-3">
                <div className="font-medium text-primary">
                  {a.action}
                  {a.fromStatus && a.toStatus ? ` — ${a.fromStatus} → ${a.toStatus}` : ''}
                </div>
                <div className="text-xs text-secondary">
                  {formatDate(a.createdAt)}
                  {a.notes ? ` · ${a.notes}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4">
        <AttachmentSection service="purchase" entityType="PURCHASE_ORDER" entityId={po.id} />
      </div>

      <Modal
        isOpen={approveOpen}
        onClose={() => setApproveOpen(false)}
        title="Approve Purchase Order"
      >
        <div className="space-y-4">
          <Input
            label="PO Number"
            required
            placeholder="e.g. PO-2026-001"
            value={poNumberInput}
            onChange={(e) => setPoNumberInput(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={approveMutation.isPending}
              disabled={!poNumberInput.trim()}
              onClick={() => approveMutation.mutate(poNumberInput)}
            >
              Approve
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel Purchase Order">
        <div className="space-y-4">
          <Input
            label="Reason"
            required
            placeholder="Reason for cancellation"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={cancelMutation.isPending}
              disabled={!cancelReason.trim()}
              onClick={() => cancelMutation.mutate(cancelReason)}
            >
              Cancel PO
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
