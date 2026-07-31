import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { grnApi } from '../../api/endpoints.js';
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
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface GRNLine {
  id: number;
  itemId: number;
  itemName?: string;
  hsnCode?: string;
  orderedQty: string;
  receivedQty: string;
  acceptedQty?: string | null;
  rejectedQty?: string;
  damagedQty?: string;
  qcStatus?: string;
  batchNumber?: string | null;
  serialNumbers?: string[] | null;
  expiryDate?: string | null;
  poRate: string;
  grnRate: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
  allocatedLandedCost: string;
  effectiveUnitCost: string;
}

interface GRNDetail {
  id: number;
  grnNumber: string | null;
  status: string;
  supplierId: number;
  supplierName?: string;
  purchaseOrderId: number;
  poNumber?: string | null;
  grnDate: string;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  grandTotal: string;
  landedCostTotal: string;
  effectiveCostTotal: string;
  hasPriceVariance: boolean;
  rcmApplicable: boolean;
  notes?: string | null;
  rejectionReason?: string | null;
  lines: GRNLine[];
}

interface LandedCost {
  id: number;
  costType: string;
  description?: string | null;
  amount: string;
  allocationMethod: string;
  isAllocated: boolean;
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
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const QC_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  NA: 'default',
  PENDING: 'warning',
  PASSED: 'success',
  FAILED: 'danger',
};

const COST_TYPES = ['CUSTOMS_DUTY', 'FREIGHT', 'INSURANCE', 'HANDLING', 'OTHER'] as const;
const ALLOCATION_METHODS = ['BY_VALUE', 'BY_QUANTITY', 'BY_WEIGHT'] as const;

export default function GRNDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canApprove = hasPermission(PERMISSIONS.GRN_APPROVE);

  const [approveOpen, setApproveOpen] = useState(false);
  const [grnNumberInput, setGrnNumberInput] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [costOpen, setCostOpen] = useState(false);
  const [costType, setCostType] = useState<(typeof COST_TYPES)[number]>('FREIGHT');
  const [costAmount, setCostAmount] = useState('');
  const [costMethod, setCostMethod] = useState<(typeof ALLOCATION_METHODS)[number]>('BY_VALUE');
  const [costDescription, setCostDescription] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['grn-detail', id],
    queryFn: () => grnApi.getById(Number(id)),
    enabled: !!id,
  });

  const { data: landedCostData } = useQuery({
    queryKey: ['grn-landed-costs', id],
    queryFn: () => grnApi.landedCosts(Number(id)),
    enabled: !!id,
  });

  const { data: activityData } = useQuery({
    queryKey: ['grn-activity', id],
    queryFn: () => grnApi.activity(Number(id)),
    enabled: !!id,
  });

  const grn = data as GRNDetail | undefined;
  const landedCosts = (landedCostData as LandedCost[] | undefined) ?? [];
  const activity = (activityData as ActivityEntry[] | undefined) ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['grn-detail', id] });
    qc.invalidateQueries({ queryKey: ['grn-landed-costs', id] });
    qc.invalidateQueries({ queryKey: ['grn-activity', id] });
  }

  const approveMutation = useMutation({
    mutationFn: (grnNumber: string) => grnApi.approve(Number(id), { grnNumber }),
    onSuccess: () => {
      toast.success('GRN approved — stock updated');
      setApproveOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => grnApi.reject(Number(id), { reason }),
    onSuccess: () => {
      toast.success('GRN rejected');
      setRejectOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCostMutation = useMutation({
    mutationFn: () =>
      grnApi.addLandedCost(Number(id), {
        costType,
        amount: parseFloat(costAmount),
        allocationMethod: costMethod,
        description: costDescription || undefined,
      }),
    onSuccess: () => {
      toast.success('Landed cost added');
      setCostOpen(false);
      setCostAmount('');
      setCostDescription('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allocateMutation = useMutation({
    mutationFn: () => grnApi.allocateLandedCost(Number(id)),
    onSuccess: () => {
      toast.success('Landed costs allocated to line items');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!grn) return <ERPEmptyState type="no-data" title="GRN not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={grn.grnNumber ?? 'Draft GRN'}
        entityType="GRN"
        entityNumber={grn.grnNumber ?? `Draft-${grn.id}`}
        status={grn.status}
        backTo="/purchase/grns"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[grn.status] ?? 'default'}>
            {grn.status.replace('_', ' ')}
          </Badge>
          {grn.hasPriceVariance && <Badge variant="warning">Price Variance</Badge>}
          {grn.rcmApplicable && <Badge variant="default">RCM</Badge>}
          {canApprove && ['DRAFT', 'PENDING_APPROVAL'].includes(grn.status) && (
            <>
              <Button onClick={() => setApproveOpen(true)}>Approve &amp; Add Stock</Button>
              <Button variant="danger" onClick={() => setRejectOpen(true)}>
                Reject
              </Button>
            </>
          )}
          {canApprove && grn.status === 'APPROVED' && (
            <Button variant="outline" onClick={() => setCostOpen(true)}>
              + Landed Cost
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Supplier', value: grn.supplierName ?? `Supplier ${grn.supplierId}` },
          { label: 'PO #', value: grn.poNumber ?? `PO-${grn.purchaseOrderId}` },
          { label: 'GRN Date', value: formatDate(grn.grnDate) },
          { label: 'Grand Total', value: formatCurrency(parseFloat(grn.grandTotal)) },
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
                <th className="pb-2 pr-3">Item</th>
                <th className="pb-2 pr-3">Batch #</th>
                <th className="pb-2 pr-3">Expiry</th>
                <th className="pb-2 pr-3 text-right">Received</th>
                <th className="pb-2 pr-3 text-right">Accepted</th>
                <th className="pb-2 pr-3 text-right">Rejected</th>
                <th className="pb-2 pr-3 text-right">Damaged</th>
                <th className="pb-2 pr-3">QC</th>
                <th className="pb-2 pr-3 text-right">Rate</th>
                <th className="pb-2 pr-3 text-right">Landed</th>
                <th className="pb-2 pr-3 text-right">Effective Cost</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {grn.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-3">{l.itemName ?? `Item ${l.itemId}`}</td>
                  <td className="py-2 pr-3 text-secondary">{l.batchNumber ?? '—'}</td>
                  <td className="py-2 pr-3 text-secondary">
                    {l.expiryDate ? formatDate(l.expiryDate) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right">{parseFloat(l.receivedQty).toFixed(3)}</td>
                  <td className="py-2 pr-3 text-right">
                    {l.acceptedQty ? parseFloat(l.acceptedQty).toFixed(3) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {parseFloat(l.rejectedQty ?? '0') > 0
                      ? parseFloat(l.rejectedQty!).toFixed(3)
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {parseFloat(l.damagedQty ?? '0') > 0
                      ? parseFloat(l.damagedQty!).toFixed(3)
                      : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant={QC_COLORS[l.qcStatus ?? 'NA'] ?? 'default'}>
                      {l.qcStatus ?? 'NA'}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-right">{formatCurrency(parseFloat(l.grnRate))}</td>
                  <td className="py-2 pr-3 text-right">
                    {formatCurrency(parseFloat(l.allocatedLandedCost ?? '0'))}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {formatCurrency(parseFloat(l.effectiveUnitCost ?? l.grnRate))}
                  </td>
                  <td className="py-2 text-right font-medium">
                    {formatCurrency(parseFloat(l.lineTotal))}
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
              <span>{formatCurrency(parseFloat(grn.taxableAmount))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">CGST + SGST + IGST</span>
              <span>
                {formatCurrency(
                  parseFloat(grn.cgstAmount) +
                    parseFloat(grn.sgstAmount) +
                    parseFloat(grn.igstAmount)
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">Landed Cost Total</span>
              <span>{formatCurrency(parseFloat(grn.landedCostTotal ?? '0'))}</span>
            </div>
            <div className="flex justify-between font-semibold text-base pt-1 border-t border-default">
              <span>Grand Total</span>
              <span>{formatCurrency(parseFloat(grn.grandTotal))}</span>
            </div>
            <div className="flex justify-between text-secondary">
              <span>Effective Cost Total</span>
              <span>{formatCurrency(parseFloat(grn.effectiveCostTotal ?? grn.grandTotal))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Landed Costs */}
      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Landed Costs</h3>
          {canApprove && grn.status === 'APPROVED' && landedCosts.some((c) => !c.isAllocated) && (
            <Button
              variant="outline"
              size="sm"
              isLoading={allocateMutation.isPending}
              onClick={() => allocateMutation.mutate()}
            >
              Allocate to Line Items
            </Button>
          )}
        </div>
        {landedCosts.length === 0 ? (
          <p className="text-sm text-secondary">
            No freight/customs/insurance/handling charges added yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Type</th>
                <th className="pb-2">Description</th>
                <th className="pb-2">Allocation</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {landedCosts.map((c) => (
                <tr key={c.id}>
                  <td className="py-2">{c.costType.replace(/_/g, ' ')}</td>
                  <td className="py-2 text-secondary">{c.description ?? '—'}</td>
                  <td className="py-2 text-secondary">{c.allocationMethod.replace(/_/g, ' ')}</td>
                  <td className="py-2 text-right">{formatCurrency(parseFloat(c.amount))}</td>
                  <td className="py-2">
                    <Badge variant={c.isAllocated ? 'success' : 'warning'}>
                      {c.isAllocated ? 'Allocated' : 'Pending'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(grn.notes || grn.rejectionReason || grn.supplierInvoiceNumber) && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4 text-sm space-y-2">
          {grn.supplierInvoiceNumber && (
            <div>
              <span className="font-medium text-primary">Supplier Invoice: </span>
              <span className="text-secondary">
                {grn.supplierInvoiceNumber}
                {grn.supplierInvoiceDate ? ` (${formatDate(grn.supplierInvoiceDate)})` : ''}
              </span>
            </div>
          )}
          {grn.notes && (
            <div>
              <span className="font-medium text-primary">Notes: </span>
              <span className="text-secondary">{grn.notes}</span>
            </div>
          )}
          {grn.rejectionReason && (
            <div>
              <span className="font-medium text-danger">Rejection Reason: </span>
              <span className="text-secondary">{grn.rejectionReason}</span>
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
        <AttachmentSection service="purchase" entityType="GRN" entityId={grn.id} />
      </div>

      <Modal isOpen={approveOpen} onClose={() => setApproveOpen(false)} title="Approve GRN">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Approving will add stock to the warehouse and update the purchase order status.
          </p>
          <Input
            label="GRN Number"
            required
            placeholder="e.g. GRN-2026-001"
            value={grnNumberInput}
            onChange={(e) => setGrnNumberInput(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={approveMutation.isPending}
              disabled={!grnNumberInput.trim()}
              onClick={() => approveMutation.mutate(grnNumberInput)}
            >
              Approve &amp; Add Stock
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject GRN">
        <div className="space-y-4">
          <Input
            label="Reason"
            required
            placeholder="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={rejectMutation.isPending}
              disabled={!rejectReason.trim()}
              onClick={() => rejectMutation.mutate(rejectReason)}
            >
              Reject GRN
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={costOpen} onClose={() => setCostOpen(false)} title="Add Landed Cost">
        <div className="space-y-4">
          <Select
            label="Cost Type"
            value={costType}
            onChange={(e) => setCostType(e.target.value as (typeof COST_TYPES)[number])}
          >
            {COST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Input
            label="Amount (₹)"
            type="number"
            step="0.01"
            required
            value={costAmount}
            onChange={(e) => setCostAmount(e.target.value)}
          />
          <Select
            label="Allocation Method"
            value={costMethod}
            onChange={(e) => setCostMethod(e.target.value as (typeof ALLOCATION_METHODS)[number])}
          >
            {ALLOCATION_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Input
            label="Description"
            value={costDescription}
            onChange={(e) => setCostDescription(e.target.value)}
            placeholder="e.g. Freight from supplier warehouse"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCostOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={addCostMutation.isPending}
              disabled={!costAmount || parseFloat(costAmount) <= 0}
              onClick={() => addCostMutation.mutate()}
            >
              Add Cost
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
