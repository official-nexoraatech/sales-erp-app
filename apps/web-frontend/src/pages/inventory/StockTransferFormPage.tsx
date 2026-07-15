import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { stockTransferApi, warehouseApi, itemApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

interface TransferLine {
  itemId: number;
  itemName: string;
  requestedQty: number;
  unitCost?: number;
}

interface Warehouse {
  id: number;
  name: string;
}
interface Item {
  id: number;
  name: string;
  itemCode?: string;
  purchasePrice?: string;
}

export default function StockTransferFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });
  const { data: itemData } = useQuery({
    queryKey: ['items', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch || undefined }),
    enabled: itemSearch.length > 1 && hasPermission(PERMISSIONS.ITEM_VIEW),
  });

  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];
  const itemResults: Item[] = (itemData as { content?: Item[] })?.content ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => stockTransferApi.create(payload),
    onSuccess: (res) => {
      const id = (res as { id?: number })?.id;
      toast.success('Transfer created');
      navigate(`/inventory/transfers/${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addLine(item: Item) {
    if (lines.find((l) => l.itemId === item.id)) return;
    // Backend requires unitCost to be omitted or > 0 — a truthy-string check on purchasePrice
    // ("0.00" is truthy) prefilled 0 for any item without a recorded purchase price, which
    // always failed creation with a 500 (same bug found+fixed in StockAdjustmentFormPage.tsx).
    const purchasePrice = item.purchasePrice ? parseFloat(item.purchasePrice) : 0;
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        requestedQty: 1,
        ...(purchasePrice > 0 ? { unitCost: purchasePrice } : {}),
      },
    ]);
    setItemSearch('');
  }

  function updateLine(idx: number, field: 'requestedQty' | 'unitCost', val: number) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(): void {
    if (!fromWarehouseId || !toWarehouseId) {
      toast.error('Select both warehouses');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      toast.error('Source and destination must differ');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one item');
      return;
    }

    createMutation.mutate({
      fromWarehouseId: Number(fromWarehouseId),
      toWarehouseId: Number(toWarehouseId),
      notes: notes || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        requestedQty: l.requestedQty,
        unitCost: l.unitCost,
      })),
    });
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Stock Transfer"
        subtitle="Move items between warehouses"
        backTo="/inventory/transfers"
      />

      <div className="space-y-6">
        <ERPFormSection title="Transfer Details" columns={2}>
          <Select
            label="From Warehouse"
            required
            value={fromWarehouseId}
            onChange={(e) => setFromWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Select source...' },
              ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
            ]}
          />
          <Select
            label="To Warehouse"
            required
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Select destination...' },
              ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
            ]}
          />
          <Input
            label="Notes"
            wrapperClassName="sm:col-span-2"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional transfer notes"
          />
        </ERPFormSection>

        <div className="bg-surface-card rounded-xl border border-default p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Items</h3>
          <Input
            label="Search item to add"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="Type item name..."
          />
          {itemResults.length > 0 && (
            <div className="mt-1 border rounded-lg divide-y bg-white dark:bg-gray-800 dark:border-gray-700 max-h-48 overflow-y-auto">
              {itemResults.map((item) => (
                <button
                  key={item.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-gray-700"
                  onClick={() => addLine(item)}
                >
                  <span className="font-medium">{item.name}</span>
                  {item.itemCode && (
                    <span className="ml-2 text-secondary font-mono text-xs">{item.itemCode}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="pb-2 font-medium">Item</th>
                <th className="pb-2 font-medium w-32">Qty</th>
                <th className="pb-2 font-medium w-32">Unit Cost (₹)</th>
                <th className="pb-2 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {lines.map((line, idx) => (
                <tr key={line.itemId}>
                  <td className="py-2">{line.itemName}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={line.requestedQty}
                      onChange={(e) =>
                        updateLine(idx, 'requestedQty', parseFloat(e.target.value) || 0)
                      }
                      className="w-28 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost ?? ''}
                      onChange={(e) => updateLine(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                      placeholder="Optional"
                      className="w-28 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2 py-1"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-danger hover:text-danger"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate('/inventory/transfers')}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} isLoading={createMutation.isPending}>
          Create Transfer
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
