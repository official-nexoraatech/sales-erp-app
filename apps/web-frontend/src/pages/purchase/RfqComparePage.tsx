import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trophy } from 'lucide-react';
import { rfqApi, branchApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import Modal from '../../components/ui/Modal.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import { createSearchLoadOptions } from '../../lib/searchSelectOptions.js';
import { formatCurrency } from '../../lib/format.js';

const loadSupplierOptions = createSearchLoadOptions('supplier');

interface RfqLine {
  id: number;
  itemId: number;
  itemName?: string;
  qty: string;
}

interface QuotationLineRow {
  id: number;
  rfqLineId: number;
  itemId: number;
  qty: string;
  unitPrice: string;
  deliveryDays: number | null;
}

interface Quotation {
  id: number;
  supplierId: number;
  supplierName?: string;
  status: string;
  grandTotal: string;
  validTill: string | null;
  lines: QuotationLineRow[];
}

interface RfqCompareData {
  rfq: { id: number; rfqNumber: string | null; status: string };
  rfqLines: RfqLine[];
  quotations: Quotation[];
}

export default function RfqComparePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRecord = hasPermission(PERMISSIONS.SUPPLIER_QUOTATION_CREATE);
  const canSelect = hasPermission(PERMISSIONS.SUPPLIER_QUOTATION_COMPARE);

  const { data, isLoading } = useQuery({
    queryKey: ['rfq-compare', id],
    queryFn: () => rfqApi.compare(Number(id)),
    enabled: !!id,
  });
  const compareData = data as RfqCompareData | undefined;

  const [recordOpen, setRecordOpen] = useState(false);
  const [supplier, setSupplier] = useState<AsyncSelectOption | null>(null);
  const [quotationNumber, setQuotationNumber] = useState('');
  const [lineInputs, setLineInputs] = useState<
    Record<number, { unitPrice: number; deliveryDays: number }>
  >({});

  const [selectingQuotationId, setSelectingQuotationId] = useState<number | null>(null);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('27');
  const [sellerState, setSellerState] = useState('27');

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const { data: warehouseData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];
  const warehouses =
    (warehouseData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const recordMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rfqApi.recordQuotation(Number(id), data),
    onSuccess: () => {
      toast.success('Quotation recorded');
      setRecordOpen(false);
      setSupplier(null);
      setQuotationNumber('');
      setLineInputs({});
      qc.invalidateQueries({ queryKey: ['rfq-compare', id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      rfqApi.selectQuotation(selectingQuotationId as number, data),
    onSuccess: (res) => {
      toast.success('Quotation selected — Purchase Order created');
      setSelectingQuotationId(null);
      qc.invalidateQueries({ queryKey: ['rfq-compare', id] });
      const poId = (res as { poId?: number })?.poId;
      navigate(poId ? `/purchase/orders/${poId}` : '/purchase/orders');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !compareData) return <ERPDetailSkeleton />;

  const { rfq, rfqLines, quotations } = compareData;

  const handleRecordQuotation = () => {
    if (!supplier) {
      toast.error('Select a supplier');
      return;
    }
    const lines = rfqLines.map((rl) => ({
      rfqLineId: rl.id,
      itemId: rl.itemId,
      qty: parseFloat(rl.qty),
      unitPrice: lineInputs[rl.id]?.unitPrice ?? 0,
      deliveryDays: lineInputs[rl.id]?.deliveryDays,
    }));
    recordMutation.mutate({
      supplierId: Number(supplier.value),
      quotationNumber: quotationNumber || undefined,
      lines,
    });
  };

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={rfq.rfqNumber ?? `RFQ #${rfq.id}`}
        subtitle="Quotation comparison"
        backTo="/purchase/rfqs"
      >
        <Badge variant={rfq.status === 'CLOSED' ? 'success' : 'warning'}>{rfq.status}</Badge>
        {canRecord && rfq.status !== 'CLOSED' && (
          <Button onClick={() => setRecordOpen(true)}>+ Record Quotation</Button>
        )}
      </ERPPageHeader>

      <div className="overflow-x-auto rounded-lg border border-default bg-surface-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle">
            <tr className="text-left text-secondary text-xs uppercase tracking-wide">
              <th scope="col" className="px-3 py-2.5 font-medium">
                Item
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium text-right">
                Requested Qty
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {rfqLines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-primary font-medium">
                  {l.itemName ?? `Item ${l.itemId}`}
                </td>
                <td className="px-3 py-2 text-right text-primary">{l.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="text-sm font-semibold text-primary mt-6 mb-3">
        Quotations Received ({quotations.length})
      </h3>

      {quotations.length === 0 && (
        <p className="text-sm text-secondary">
          No quotations recorded yet — record what each invited supplier quoted to compare them
          here.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {quotations.map((q) => (
          <div
            key={q.id}
            className={`rounded-xl border p-4 ${
              q.status === 'SELECTED'
                ? 'border-success bg-success-subtle'
                : 'border-default bg-surface-card'
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold text-primary">
                  {q.supplierName ?? `Supplier ${q.supplierId}`}
                </p>
                <p className="text-xs text-secondary">{formatCurrency(parseFloat(q.grandTotal))}</p>
              </div>
              <Badge
                variant={
                  q.status === 'SELECTED'
                    ? 'success'
                    : q.status === 'REJECTED'
                      ? 'danger'
                      : 'default'
                }
              >
                {q.status}
              </Badge>
            </div>
            <ul className="text-xs text-secondary space-y-1 mb-3">
              {q.lines.map((ql) => (
                <li key={ql.id} className="flex justify-between">
                  <span>Qty {ql.qty}</span>
                  <span>
                    {formatCurrency(parseFloat(ql.unitPrice))}
                    {ql.deliveryDays ? ` · ${ql.deliveryDays}d` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {canSelect && q.status === 'SUBMITTED' && rfq.status !== 'CLOSED' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectingQuotationId(q.id)}
                className="w-full"
              >
                <Trophy size={14} className="mr-1.5" /> Select as Winner
              </Button>
            )}
          </div>
        ))}
      </div>

      <Modal
        isOpen={recordOpen}
        onClose={() => setRecordOpen(false)}
        title="Record Supplier Quotation"
        size="lg"
      >
        <div className="space-y-4">
          <ERPAsyncSelect
            label="Supplier"
            required
            value={supplier}
            onChange={setSupplier}
            loadOptions={loadSupplierOptions}
            placeholder="Type to search suppliers…"
          />
          <Input
            label="Quotation Number"
            value={quotationNumber}
            onChange={(e) => setQuotationNumber(e.target.value)}
            placeholder="Supplier's own reference (optional)"
          />
          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr className="text-left text-secondary text-xs uppercase tracking-wide">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    Qty
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    Unit Price
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    Delivery (days)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {rfqLines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-primary">{l.itemName ?? `Item ${l.itemId}`}</td>
                    <td className="px-3 py-2 text-right text-secondary">{l.qty}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        step="0.01"
                        value={lineInputs[l.id]?.unitPrice ?? 0}
                        onChange={(e) =>
                          setLineInputs((prev) => ({
                            ...prev,
                            [l.id]: {
                              unitPrice: parseFloat(e.target.value) || 0,
                              deliveryDays: prev[l.id]?.deliveryDays ?? 0,
                            },
                          }))
                        }
                        aria-label={`Unit price for ${l.itemName}`}
                        className="w-24 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        step="1"
                        value={lineInputs[l.id]?.deliveryDays ?? 0}
                        onChange={(e) =>
                          setLineInputs((prev) => ({
                            ...prev,
                            [l.id]: {
                              unitPrice: prev[l.id]?.unitPrice ?? 0,
                              deliveryDays: parseInt(e.target.value, 10) || 0,
                            },
                          }))
                        }
                        aria-label={`Delivery days for ${l.itemName}`}
                        className="w-20 text-right ml-auto"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRecordOpen(false)}>
              Cancel
            </Button>
            <Button isLoading={recordMutation.isPending} onClick={handleRecordQuotation}>
              Save Quotation
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={selectingQuotationId !== null}
        onClose={() => setSelectingQuotationId(null)}
        title="Select Winning Quotation"
      >
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            This will create a draft Purchase Order from the selected quotation's lines.
          </p>
          <Select
            label="Branch"
            required
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[
              { value: '', label: 'Select branch…' },
              ...branches.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
          />
          <Select
            label="Warehouse"
            required
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Select warehouse…' },
              ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Place of Supply"
              required
              value={placeOfSupply}
              onChange={(e) => setPlaceOfSupply(e.target.value)}
              options={[
                { value: '', label: 'Select state…' },
                ...INDIAN_STATES.map((s) => ({
                  value: s.gstCode,
                  label: `${s.gstCode} – ${s.name}`,
                })),
              ]}
            />
            <Select
              label="Seller State"
              required
              value={sellerState}
              onChange={(e) => setSellerState(e.target.value)}
              options={[
                { value: '', label: 'Select state…' },
                ...INDIAN_STATES.map((s) => ({
                  value: s.gstCode,
                  label: `${s.gstCode} – ${s.name}`,
                })),
              ]}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSelectingQuotationId(null)}>
              Cancel
            </Button>
            <Button
              isLoading={selectMutation.isPending}
              disabled={!branchId || !warehouseId}
              onClick={() =>
                selectMutation.mutate({
                  branchId: Number(branchId),
                  warehouseId: Number(warehouseId),
                  poDate: new Date().toISOString(),
                  placeOfSupply,
                  sellerStateCode: sellerState,
                })
              }
            >
              Create Purchase Order
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
