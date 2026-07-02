import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Select from '../../components/ui/Select.js';

interface ReorderItem {
  itemId: number;
  itemName: string;
  sku?: string;
  availableQty: number;
  reorderLevel: number;
  reorderQty: number;
  defaultSupplierId?: number;
  supplierName?: string;
  lastPurchasePrice?: string;
}

export default function ReorderReportPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [warehouseId, setWarehouseId] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => warehouseApi.list(),
  });
  const warehouses =
    ((warehousesData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reorder-required', warehouseId],
    queryFn: () =>
      warehouseId
        ? productionApi.getReorderRequired({ warehouseId: parseInt(warehouseId, 10) })
        : productionApi.getReorderRequired(),
  });
  const items: ReorderItem[] = ((data as Record<string, unknown>)?.data as ReorderItem[]) ?? [];

  const createPOMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => productionApi.createReorderPOs(payload),
    onSuccess: (res) => {
      const result = (res as Record<string, unknown>)?.data as { poIds?: number[] } | undefined;
      toast.success(`${result?.poIds?.length ?? 0} purchase order(s) created`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      void refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleSelect(itemId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(items.map((i) => i.itemId)));
  }

  function handleCreatePOs() {
    const selectedItems = items.filter((i) => selected.has(i.itemId));
    if (!selectedItems.length) {
      toast.error('Select at least one item');
      return;
    }
    const wId = warehouseId ? parseInt(warehouseId, 10) : warehouses[0]?.id;
    if (!wId) {
      toast.error('Please select a warehouse');
      return;
    }

    createPOMutation.mutate({
      branchId: 1,
      warehouseId: wId,
      placeOfSupply: '27',
      items: selectedItems
        .filter((i) => i.defaultSupplierId)
        .map((i) => ({
          itemId: i.itemId,
          supplierId: i.defaultSupplierId!,
          quantity: i.reorderQty,
          unitPrice: parseFloat(i.lastPurchasePrice ?? '0'),
        })),
    });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Reorder Report"
        subtitle="Items below reorder level — create purchase orders with one click."
        actions={
          hasPermission(PERMISSIONS.REORDER_CREATE_PO) && selected.size > 0 ? (
            <Button onClick={handleCreatePOs} disabled={createPOMutation.isPending}>
              {createPOMutation.isPending ? 'Creating POs…' : `Create POs (${selected.size} items)`}
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-3 mb-4 items-center">
        <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="max-w-xs">
          <option value="">All Warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        {items.length > 0 && (
          <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
        )}
        {selected.size > 0 && (
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>Deselect All</Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-secondary text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <div className="bg-surface-card rounded-xl border border-default p-8 text-center">
          <p className="text-success font-medium">All items are above reorder levels.</p>
          <p className="text-xs text-secondary mt-1">No action required.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-secondary mb-3">
            {items.length} item(s) need restocking.
            {selected.size > 0 && ` ${selected.size} selected.`}
          </p>
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={(e) => e.target.checked ? selectAll() : setSelected(new Set())}
                  />
                </th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">Reorder Level</th>
                <th className="px-4 py-3 text-right">Reorder Qty</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-right">Last Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {items.map((item) => (
                <tr
                  key={item.itemId}
                  className={`hover:bg-surface-subtle cursor-pointer ${selected.has(item.itemId) ? 'bg-primary/5' : ''}`}
                  onClick={() => toggleSelect(item.itemId)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(item.itemId)}
                      onChange={() => toggleSelect(item.itemId)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium">{item.itemName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-secondary">{item.sku ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-danger font-semibold">{item.availableQty}</td>
                  <td className="px-4 py-3 text-right font-mono">{item.reorderLevel}</td>
                  <td className="px-4 py-3 text-right font-mono">{item.reorderQty}</td>
                  <td className="px-4 py-3 text-xs">{item.supplierName ?? <span className="text-warning">No supplier</span>}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {item.lastPurchasePrice ? `₹${item.lastPurchasePrice}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
