import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseOrderApi, itemApi, warehouseApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import { createSearchLoadOptions } from '../../lib/searchSelectOptions.js';

const loadSupplierOptions = createSearchLoadOptions('supplier');

interface LineItem {
  itemId: number;
  itemName: string;
  orderedQty: number;
  unitPrice: number;
  discountPct: number;
  gstRate: number;
  hsnCode: string;
  taxableAmount: number;
  lineTotal: number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function computeLine(l: LineItem, sellerState: string, placeOfSupply: string) {
  const subtotal = round2(l.unitPrice * l.orderedQty);
  const discount = round2((subtotal * l.discountPct) / 100);
  const taxable = round2(subtotal - discount);
  const isIntra = sellerState === placeOfSupply;
  const cgst = isIntra ? round2((taxable * l.gstRate) / 2 / 100) : 0;
  const sgst = isIntra ? round2((taxable * l.gstRate) / 2 / 100) : 0;
  const igst = isIntra ? 0 : round2((taxable * l.gstRate) / 100);
  return { taxable, cgst, sgst, igst, lineTotal: round2(taxable + cgst + sgst + igst) };
}

export default function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [selectedSupplier, setSelectedSupplier] = useState<AsyncSelectOption | null>(null);
  const supplierId = selectedSupplier ? String(selectedSupplier.value) : '';
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('27');
  const [sellerState, setSellerState] = useState('27');
  const [poDate, setPoDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>(
    new Date(Date.now() + 14 * 86400_000).toISOString().substring(0, 10)
  );
  const [notes, setNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: warehouseData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });
  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const { data: itemData } = useQuery({
    queryKey: ['item-search', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch }),
    enabled: itemSearch.length > 1 && hasPermission(PERMISSIONS.ITEM_VIEW),
  });

  const warehouses =
    (warehouseData as { content?: Array<{ id: number; name: string }> })?.content ?? [];
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];
  const itemOptions =
    (
      itemData as {
        content?: Array<{ id: number; name: string; gstRate?: number; hsnCode?: string }>;
      }
    )?.content ?? [];

  const computedLines = lines.map((l) => ({ ...l, ...computeLine(l, sellerState, placeOfSupply) }));

  const totals = computedLines.reduce(
    (acc, l) => ({
      subtotal: round2(acc.subtotal + l.unitPrice * l.orderedQty),
      discount: round2(acc.discount + (l.unitPrice * l.orderedQty * l.discountPct) / 100),
      taxable: round2(acc.taxable + l.taxable),
      cgst: round2(acc.cgst + l.cgst),
      sgst: round2(acc.sgst + l.sgst),
      igst: round2(acc.igst + l.igst),
      grand: round2(acc.grand + l.lineTotal),
    }),
    { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0 }
  );

  const addItem = (item: { id: number; name: string; gstRate?: number; hsnCode?: string }) => {
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        orderedQty: 1,
        unitPrice: 0,
        discountPct: 0,
        gstRate: item.gstRate ?? 18,
        hsnCode: item.hsnCode ?? '',
        taxableAmount: 0,
        lineTotal: 0,
      },
    ]);
    setItemSearch('');
  };

  const updateLine = (idx: number, field: keyof LineItem, value: number | string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => purchaseOrderApi.create(data),
    onSuccess: () => {
      toast.success('Purchase order created as DRAFT');
      navigate('/purchase/orders');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!supplierId || !branchId || !warehouseId || lines.length === 0) {
      toast.error('Fill all required fields and add at least one item');
      return;
    }
    createMutation.mutate({
      supplierId: Number(supplierId),
      branchId: Number(branchId),
      warehouseId: Number(warehouseId),
      poDate: new Date(poDate).toISOString(),
      expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString(),
      placeOfSupply,
      sellerStateCode: sellerState,
      notes: notes || undefined,
      termsAndConditions: termsAndConditions || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        orderedQty: l.orderedQty,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        discountAmount: round2((l.unitPrice * l.orderedQty * l.discountPct) / 100),
        gstRate: l.gstRate,
        hsnCode: l.hsnCode || undefined,
      })),
    });
  };

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="New Purchase Order"
        subtitle="Create a purchase order for a supplier"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
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
        <Input
          label="PO Date"
          required
          type="date"
          value={poDate}
          onChange={(e) => setPoDate(e.target.value)}
        />
        <Input
          label="Expected Delivery Date"
          type="date"
          value={expectedDeliveryDate}
          onChange={(e) => setExpectedDeliveryDate(e.target.value)}
        />
        <Select
          label="Place of Supply"
          required
          value={placeOfSupply}
          onChange={(e) => setPlaceOfSupply(e.target.value)}
          options={[
            { value: '', label: 'Select state…' },
            ...INDIAN_STATES.map((s) => ({ value: s.gstCode, label: `${s.gstCode} – ${s.name}` })),
          ]}
        />
        <Select
          label="Seller State (Your State)"
          required
          value={sellerState}
          onChange={(e) => setSellerState(e.target.value)}
          options={[
            { value: '', label: 'Select state…' },
            ...INDIAN_STATES.map((s) => ({ value: s.gstCode, label: `${s.gstCode} – ${s.name}` })),
          ]}
        />
      </div>

      {/* Line Items */}
      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4 overflow-x-auto">
        <h3 className="text-sm font-semibold text-primary mb-3">Order Lines</h3>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Search items to add…"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            className="flex-1 rounded-lg border border-default bg-surface-card px-3 py-2 text-sm text-primary"
          />
        </div>
        {itemSearch.length > 1 && itemOptions.length > 0 && (
          <div className="border border-default rounded-lg mb-4 max-h-40 overflow-y-auto">
            {itemOptions.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-raised text-primary"
              >
                {item.name} — GST {item.gstRate ?? 18}%
              </button>
            ))}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary border-b border-default">
              <th className="pb-2 pr-2">Item</th>
              <th className="pb-2 pr-2">Qty</th>
              <th className="pb-2 pr-2">Unit Price</th>
              <th className="pb-2 pr-2">Disc %</th>
              <th className="pb-2 pr-2">GST %</th>
              <th className="pb-2 pr-2 text-right">Taxable</th>
              <th className="pb-2 pr-2 text-right">Total</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {computedLines.map((l, idx) => (
              <tr key={idx}>
                <td className="py-2 pr-2 text-primary">{l.itemName}</td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={l.orderedQty}
                    onChange={(e) => updateLine(idx, 'orderedQty', parseFloat(e.target.value) || 0)}
                    className="w-20 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unitPrice}
                    onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                    className="w-28 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={l.discountPct}
                    onChange={(e) =>
                      updateLine(idx, 'discountPct', parseFloat(e.target.value) || 0)
                    }
                    className="w-16 rounded border border-default bg-surface-card px-2 py-1 text-sm text-primary"
                  />
                </td>
                <td className="py-2 pr-2 text-secondary">{l.gstRate}%</td>
                <td className="py-2 pr-2 text-right text-primary">₹{l.taxable.toFixed(2)}</td>
                <td className="py-2 pr-2 text-right font-semibold text-primary">
                  ₹{l.lineTotal.toFixed(2)}
                </td>
                <td className="py-2">
                  <button
                    onClick={() => removeLine(idx)}
                    className="text-danger hover:opacity-70 text-xs px-1"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-disabled text-sm">
                  Search and add items above to build the order
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {lines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-default flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-secondary">Subtotal</span>
                <span className="text-primary">₹{totals.subtotal.toFixed(2)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-danger">
                  <span>Discount</span>
                  <span>-₹{totals.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-secondary">Taxable Amount</span>
                <span className="text-primary">₹{totals.taxable.toFixed(2)}</span>
              </div>
              {totals.cgst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">CGST</span>
                  <span className="text-primary">₹{totals.cgst.toFixed(2)}</span>
                </div>
              )}
              {totals.sgst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">SGST</span>
                  <span className="text-primary">₹{totals.sgst.toFixed(2)}</span>
                </div>
              )}
              {totals.igst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">IGST</span>
                  <span className="text-primary">₹{totals.igst.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-2 border-t border-default">
                <span className="text-primary">Grand Total</span>
                <span className="text-primary">₹{totals.grand.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ERPTextarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes for this purchase order…"
        />
        <ERPTextarea
          label="Terms & Conditions"
          value={termsAndConditions}
          onChange={(e) => setTermsAndConditions(e.target.value)}
          rows={3}
          placeholder="Payment terms, delivery terms, etc."
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => navigate('/purchase/orders')}>
          Cancel
        </Button>
        <Button isLoading={createMutation.isPending} onClick={handleSubmit}>
          Save as Draft
        </Button>
      </div>
    </div>
  );
}
