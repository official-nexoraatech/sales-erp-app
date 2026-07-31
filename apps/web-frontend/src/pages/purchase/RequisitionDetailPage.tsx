import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { requisitionApi, branchApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import { createSearchLoadOptions } from '../../lib/searchSelectOptions.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

const loadSupplierOptions = createSearchLoadOptions('supplier');

interface RequisitionLine {
  id: number;
  itemId: number;
  itemName?: string;
  description?: string;
  requestedQty: string;
  estimatedUnitPrice: string;
}

interface RequisitionDetail {
  id: number;
  requisitionNumber: string | null;
  department: string | null;
  priority: string;
  status: string;
  requiredByDate: string | null;
  estimatedTotal: string;
  notes?: string;
  rejectionReason?: string;
  convertedToPoId?: number | null;
  lines: RequisitionLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CONVERTED: 'success',
  CANCELLED: 'danger',
};

export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canConvert = hasPermission(PERMISSIONS.REQUISITION_CONVERT);

  const { data, isLoading } = useQuery({
    queryKey: ['requisition', id],
    queryFn: () => requisitionApi.getById(Number(id)),
    enabled: !!id,
  });
  const req = data as RequisitionDetail | undefined;

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

  const [selectedSupplier, setSelectedSupplier] = useState<AsyncSelectOption | null>(null);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('27');
  const [sellerState, setSellerState] = useState('27');
  const [gstRates, setGstRates] = useState<Record<number, number>>({});
  const [unitPrices, setUnitPrices] = useState<Record<number, number>>({});

  const convertMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => requisitionApi.convertToPO(Number(id), data),
    onSuccess: (res) => {
      toast.success('Requisition converted to a draft Purchase Order');
      qc.invalidateQueries({ queryKey: ['requisition', id] });
      const poId = (res as { poId?: number })?.poId;
      navigate(poId ? `/purchase/orders/${poId}` : '/purchase/orders');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !req) return <ERPDetailSkeleton />;

  const handleConvert = () => {
    if (!selectedSupplier || !branchId || !warehouseId) {
      toast.error('Select a supplier, branch, and warehouse');
      return;
    }
    convertMutation.mutate({
      supplierId: Number(selectedSupplier.value),
      branchId: Number(branchId),
      warehouseId: Number(warehouseId),
      poDate: new Date().toISOString(),
      placeOfSupply,
      sellerStateCode: sellerState,
      lineOverrides: req.lines.map((l) => ({
        itemId: l.itemId,
        unitPrice: unitPrices[l.itemId] ?? parseFloat(l.estimatedUnitPrice),
        gstRate: gstRates[l.itemId] ?? 18,
      })),
    });
  };

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={req.requisitionNumber ?? `Requisition #${req.id}`}
        backTo="/purchase/requisitions"
        {...(req.department ? { subtitle: req.department } : {})}
      >
        <Badge variant={STATUS_COLORS[req.status] ?? 'default'}>{req.status}</Badge>
      </ERPPageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide">Priority</p>
          <p className="text-lg font-semibold text-primary">{req.priority}</p>
        </div>
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide">Estimated Total</p>
          <p className="text-lg font-semibold text-primary">
            {formatCurrency(parseFloat(req.estimatedTotal))}
          </p>
        </div>
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide">Required By</p>
          <p className="text-lg font-semibold text-primary">
            {req.requiredByDate ? formatDate(req.requiredByDate) : '—'}
          </p>
        </div>
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <p className="text-xs text-secondary uppercase tracking-wide">Lines</p>
          <p className="text-lg font-semibold text-primary">{req.lines.length}</p>
        </div>
      </div>

      {req.rejectionReason && (
        <div className="bg-danger-subtle border border-danger/30 rounded-lg p-3 mb-4 text-sm text-danger">
          Rejected: {req.rejectionReason}
        </div>
      )}

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
              <th scope="col" className="px-3 py-2.5 font-medium text-right">
                Est. Unit Price
              </th>
              {req.status === 'APPROVED' && canConvert && (
                <>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    PO Unit Price
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    GST %
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {req.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-primary font-medium">
                  {l.itemName ?? `Item ${l.itemId}`}
                </td>
                <td className="px-3 py-2 text-right text-primary">{l.requestedQty}</td>
                <td className="px-3 py-2 text-right text-secondary">
                  {formatCurrency(parseFloat(l.estimatedUnitPrice))}
                </td>
                {req.status === 'APPROVED' && canConvert && (
                  <>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        step="0.01"
                        value={unitPrices[l.itemId] ?? parseFloat(l.estimatedUnitPrice)}
                        onChange={(e) =>
                          setUnitPrices((prev) => ({
                            ...prev,
                            [l.itemId]: parseFloat(e.target.value) || 0,
                          }))
                        }
                        aria-label={`PO unit price for ${l.itemName}`}
                        className="w-28 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        max="100"
                        step="0.01"
                        value={gstRates[l.itemId] ?? 18}
                        onChange={(e) =>
                          setGstRates((prev) => ({
                            ...prev,
                            [l.itemId]: parseFloat(e.target.value) || 0,
                          }))
                        }
                        aria-label={`GST rate for ${l.itemName}`}
                        className="w-20 text-right ml-auto"
                      />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {req.status === 'APPROVED' && canConvert && (
        <>
          <div className="bg-surface-card rounded-xl border border-default p-4 mt-4">
            <h3 className="text-sm font-semibold text-primary mb-3">Convert to Purchase Order</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <ERPAsyncSelect
                label="Supplier"
                required
                value={selectedSupplier}
                onChange={setSelectedSupplier}
                loadOptions={loadSupplierOptions}
                placeholder="Type to search suppliers…"
              />
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
          </div>
          <ERPStickyFooter>
            <Button isLoading={convertMutation.isPending} onClick={handleConvert}>
              Create Purchase Order
            </Button>
          </ERPStickyFooter>
        </>
      )}
    </div>
  );
}
