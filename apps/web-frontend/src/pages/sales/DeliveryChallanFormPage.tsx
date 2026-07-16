import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  deliveryChallanApi,
  itemApi,
  customerApi,
  warehouseApi,
  branchApi,
} from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency } from '../../lib/format.js';

interface LineItem {
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  hsnCode: string;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function DeliveryChallanFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [challanDate, setChallanDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: itemData } = useQuery({
    queryKey: ['item-search', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch }),
    enabled: itemSearch.length > 1 && hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const { data: customerData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customerApi.list({}),
    enabled: hasPermission(PERMISSIONS.CUSTOMER_VIEW),
  });
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

  const itemOptions =
    (
      itemData as {
        content?: Array<{ id: number; name: string; hsnCode?: string; minSalePrice?: string }>;
      }
    )?.content ?? [];
  const customers =
    (customerData as { content?: Array<{ id: number; displayName: string }> })?.content ?? [];
  const warehouses =
    (warehouseData as { content?: Array<{ id: number; name: string }> })?.content ?? [];
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const computedLines = lines.map((l) => ({ ...l, lineTotal: round2(l.unitPrice * l.quantity) }));
  const subtotal = round2(computedLines.reduce((sum, l) => sum + l.lineTotal, 0));

  const addItem = (item: { id: number; name: string; hsnCode?: string; minSalePrice?: string }) => {
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        quantity: 1,
        unitPrice: item.minSalePrice ? parseFloat(item.minSalePrice) : 0,
        hsnCode: item.hsnCode ?? '',
      },
    ]);
    setItemSearch('');
  };

  const updateLine = (idx: number, field: keyof LineItem, value: number | string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => deliveryChallanApi.create(data),
    onSuccess: (data: unknown) => {
      const result = data as { id?: number };
      toast.success('Delivery challan created');
      navigate(`/sales/delivery-challans/${result?.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (): void => {
    if (!customerId || !branchId || !warehouseId || lines.length === 0) {
      toast.error('Fill all required fields and add at least one item');
      return;
    }

    createMutation.mutate({
      customerId: Number(customerId),
      branchId: Number(branchId),
      warehouseId: Number(warehouseId),
      challanDate: new Date(challanDate).toISOString(),
      notes: notes || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        hsnCode: l.hsnCode || undefined,
      })),
    });
  };

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Delivery Challan"
        subtitle="Record goods dispatched to a customer before invoicing"
        backTo="/sales/delivery-challans"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Select
          label="Customer"
          required
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          options={[
            { value: '', label: 'Select customer...' },
            ...customers.map((c) => ({ value: String(c.id), label: c.displayName })),
          ]}
        />
        <Select
          label="Branch"
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={[
            { value: '', label: 'Select branch...' },
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
        />
        <Select
          label="Warehouse"
          required
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={[
            { value: '', label: 'Select warehouse...' },
            ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
          ]}
        />
        <Input
          label="Challan Date"
          required
          type="date"
          value={challanDate}
          onChange={(e) => setChallanDate(e.target.value)}
        />
      </div>

      {/* Line Items */}
      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Search items to add..."
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            className="flex-1 rounded-lg border border-default bg-surface-card px-3 py-2 text-sm"
          />
        </div>
        {itemSearch.length > 1 && itemOptions.length > 0 && (
          <div className="border border-default rounded-lg mb-4 max-h-40 overflow-y-auto">
            {itemOptions.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-raised"
              >
                {item.name}
              </button>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Item</th>
                <th className="pb-2">Qty</th>
                <th className="pb-2">Price</th>
                <th className="pb-2">HSN</th>
                <th className="pb-2">Total</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {computedLines.map((l, idx) => (
                <tr key={idx}>
                  <td className="py-2 pr-2">{l.itemName}</td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-20 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.unitPrice}
                      onChange={(e) =>
                        updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)
                      }
                      className="w-24 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={l.hsnCode}
                      onChange={(e) => updateLine(idx, 'hsnCode', e.target.value)}
                      className="w-24 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold">
                    {formatCurrency(l.lineTotal)}
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-danger hover:text-danger text-xs"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-disabled text-sm">
                    No items added yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {lines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-default flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between font-bold text-base">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-6">
        <ERPTextarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes for this challan…"
        />
      </div>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate('/sales/delivery-challans')}>
          Cancel
        </Button>
        <Button isLoading={createMutation.isPending} onClick={handleSubmit}>
          Save as Draft
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
