import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { stockAdjustmentApi, warehouseApi, itemApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

interface AdjLine { itemId: number; itemName: string; direction: 'IN' | 'OUT'; quantity: number; unitCost?: number; reason?: string; }
interface Warehouse { id: number; name: string; }
interface Item { id: number; name: string; purchasePrice?: string; }

const ADJ_TYPES = ['DAMAGE', 'EXPIRY', 'THEFT', 'SHORTAGE', 'EXCESS', 'QUALITY_ISSUE', 'SAMPLE_ISSUED', 'RETURN_TO_VENDOR'];

export default function StockAdjustmentFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [warehouseId, setWarehouseId] = useState('');
  const [adjustmentType, setAdjustmentType] = useState('DAMAGE');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<AdjLine[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: whData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehouseApi.list(), enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW) });
  const { data: itemData } = useQuery({
    queryKey: ['items', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch }),
    enabled: itemSearch.length > 1 && hasPermission(PERMISSIONS.ITEM_VIEW),
  });

  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];
  const itemResults: Item[] = (itemData as { content?: Item[] })?.content ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => stockAdjustmentApi.create(payload),
    onSuccess: () => { toast.success('Adjustment created'); navigate('/inventory/adjustments'); },
    onError: (e: Error) => toast.error(e.message),
  });

  function addLine(item: Item) {
    if (lines.find((l) => l.itemId === item.id)) return;
    setLines((prev) => [
      ...prev,
      { itemId: item.id, itemName: item.name, direction: 'OUT' as const, quantity: 1, ...(item.purchasePrice ? { unitCost: parseFloat(item.purchasePrice) } : {}) },
    ]);
    setItemSearch('');
  }

  function updateLine(idx: number, field: keyof AdjLine, val: unknown) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l)));
  }

  function handleSubmit(): void {
    if (!warehouseId) { toast.error('Select a warehouse'); return; }
    if (lines.length === 0) { toast.error('Add at least one item'); return; }
    createMutation.mutate({
      warehouseId: Number(warehouseId),
      adjustmentType,
      notes: notes || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        direction: l.direction,
        quantity: l.quantity,
        unitCost: l.unitCost,
        reason: l.reason,
      })),
    });
  }

  return (
    <div>
      <ERPPageHeader variant="list" title="New Stock Adjustment" subtitle="Record stock gain or loss" />
      <div className="space-y-6">
        <ERPFormSection title="Adjustment Details" columns={2}>
          <Select label="Warehouse" required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            options={[{ value: '', label: 'Select warehouse...' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]} />
          <Select label="Adjustment Type" required value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}
            options={ADJ_TYPES.map((t) => ({ value: t, label: t.replace('_', ' ') }))} />
          <Input label="Notes" wrapperClassName="sm:col-span-2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </ERPFormSection>

        <div className="bg-surface-card rounded-xl border border-default p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Items</h3>
          <Input label="Search item" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="Type item name…" />
          {itemResults.length > 0 && (
            <div className="mt-1 border rounded-lg divide-y bg-white dark:bg-gray-800 dark:border-gray-700 max-h-40 overflow-y-auto">
              {itemResults.map((item) => (
                <button key={item.id} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-gray-700" onClick={() => addLine(item)}>
                  {item.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="pb-2">Item</th>
                <th className="pb-2 w-24">Direction</th>
                <th className="pb-2 w-28">Quantity</th>
                <th className="pb-2 w-28">Unit Cost</th>
                <th className="pb-2 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {lines.map((line, idx) => (
                <tr key={line.itemId}>
                  <td className="py-2">{line.itemName}</td>
                  <td className="py-2">
                    <select
                      value={line.direction}
                      onChange={(e) => updateLine(idx, 'direction', e.target.value)}
                      className="text-xs rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1 py-1"
                    >
                      <option value="IN">IN (+)</option>
                      <option value="OUT">OUT (–)</option>
                    </select>
                  </td>
                  <td className="py-2">
                    <input type="number" min="0.001" step="0.001" value={line.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-24 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2 py-1" />
                  </td>
                  <td className="py-2">
                    <input type="number" min="0" step="0.01" value={line.unitCost ?? ''}
                      onChange={(e) => updateLine(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                      placeholder="Optional"
                      className="w-24 rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-2 py-1" />
                  </td>
                  <td className="py-2">
                    <button onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} className="text-danger hover:text-danger">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => navigate('/inventory/adjustments')}>Cancel</Button>
          <Button onClick={handleSubmit} isLoading={createMutation.isPending}>Create Adjustment</Button>
        </div>
      </div>
    </div>
  );
}
