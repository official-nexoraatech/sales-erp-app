import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi, supplierApi, itemApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate } from '../../lib/format.js';

interface ConsignmentStock {
  id: number;
  supplierName?: string;
  itemName?: string;
  warehouseName?: string;
  receivedQty: number;
  soldQty: number;
  returnedQty: number;
  availableQty: number;
  agreedRate: string;
  receivedDate: string;
  referenceNumber?: string;
  status: string;
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  ACTIVE: 'success',
  SETTLED: 'default',
  RETURNED: 'info',
  PARTIAL: 'warning',
};

export default function ConsignmentStockPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [showReceiveForm, setShowReceiveForm] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState('');

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => supplierApi.list(),
    enabled: hasPermission(PERMISSIONS.SUPPLIER_VIEW),
  });
  const suppliers =
    ((suppliersData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data: itemsData } = useQuery({
    queryKey: ['items-list'],
    queryFn: () => itemApi.list(),
    enabled: hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const items =
    ((itemsData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });
  const warehouses =
    ((warehousesData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['consignment-stock', supplierFilter],
    queryFn: () =>
      supplierFilter
        ? productionApi.listConsignmentStock({ supplierId: parseInt(supplierFilter, 10) })
        : productionApi.listConsignmentStock(),
  });
  const stocks: ConsignmentStock[] = (data as ConsignmentStock[]) ?? [];

  // Receive form state
  const [rSupplierId, setRSupplierId] = useState('');
  const [rItemId, setRItemId] = useState('');
  const [rWarehouseId, setRWarehouseId] = useState('');
  const [rQty, setRQty] = useState('');
  const [rRate, setRRate] = useState('');
  const [rDate, setRDate] = useState(new Date().toISOString().slice(0, 10));
  const [rRef, setRRef] = useState('');

  const receiveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => productionApi.receiveConsignment(payload),
    onSuccess: () => {
      toast.success('Consignment received');
      setShowReceiveForm(false);
      qc.invalidateQueries({ queryKey: ['consignment-stock'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnMutation = useMutation({
    mutationFn: ({ id, returnQty }: { id: number; returnQty: number }) =>
      productionApi.returnConsignment(id, { returnQty }),
    onSuccess: () => {
      toast.success('Stock returned to supplier');
      qc.invalidateQueries({ queryKey: ['consignment-stock'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleReceive(e: React.FormEvent) {
    e.preventDefault();
    receiveMutation.mutate({
      supplierId: parseInt(rSupplierId, 10),
      itemId: parseInt(rItemId, 10),
      warehouseId: parseInt(rWarehouseId, 10),
      receivedQty: parseFloat(rQty),
      agreedRate: parseFloat(rRate),
      receivedDate: new Date(rDate).toISOString(),
      referenceNumber: rRef || undefined,
    });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Consignment Stock"
        subtitle="Track goods received on consignment — not on balance sheet until sold."
        actions={
          hasPermission(PERMISSIONS.CONSIGNMENT_RECEIVE) ? (
            <Button onClick={() => setShowReceiveForm(!showReceiveForm)}>
              {showReceiveForm ? 'Cancel' : '+ Receive Consignment'}
            </Button>
          ) : undefined
        }
      />

      {showReceiveForm && (
        <div className="bg-surface-card rounded-xl border border-default p-6 mb-6">
          <h3 className="font-semibold text-primary mb-4">Receive Consignment Stock</h3>
          <form onSubmit={handleReceive} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Supplier"
              required
              value={rSupplierId}
              onChange={(e) => setRSupplierId(e.target.value)}
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select
              label="Item"
              required
              value={rItemId}
              onChange={(e) => setRItemId(e.target.value)}
            >
              <option value="">Select item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
            <Select
              label="Warehouse"
              required
              value={rWarehouseId}
              onChange={(e) => setRWarehouseId(e.target.value)}
            >
              <option value="">Select warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Input
              label="Received Qty"
              required
              type="number"
              min="0.01"
              step="0.01"
              value={rQty}
              onChange={(e) => setRQty(e.target.value)}
            />
            <Input
              label="Agreed Rate"
              required
              type="number"
              min="0"
              step="0.01"
              value={rRate}
              onChange={(e) => setRRate(e.target.value)}
            />
            <Input
              label="Received Date"
              required
              type="date"
              value={rDate}
              onChange={(e) => setRDate(e.target.value)}
            />
            <Input
              label="Reference #"
              value={rRef}
              onChange={(e) => setRRef(e.target.value)}
              placeholder="Supplier delivery note"
            />
            <div className="col-span-2 flex items-end gap-3">
              <Button type="submit" disabled={receiveMutation.isPending}>
                {receiveMutation.isPending ? 'Receiving…' : 'Receive Stock'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="mb-4">
        <Select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="max-w-xs"
        >
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <ERPTableSkeleton rows={6} cols={10} />
      ) : stocks.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No consignment stock on file"
          description="Goods received on consignment from suppliers will appear here."
          {...(hasPermission(PERMISSIONS.CONSIGNMENT_RECEIVE)
            ? {
                action: { label: '+ Receive Consignment', onClick: () => setShowReceiveForm(true) },
              }
            : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Warehouse</th>
                <th className="px-4 py-3 text-right">Received</th>
                <th className="px-4 py-3 text-right">Sold</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3">Received On</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {stocks.map((s) => (
                <tr key={s.id} className="hover:bg-surface-subtle">
                  <td className="px-4 py-3">{s.supplierName ?? '—'}</td>
                  <td className="px-4 py-3">{s.itemName ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-secondary">{s.warehouseName ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.receivedQty}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.soldQty}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{s.availableQty}</td>
                  <td className="px-4 py-3 text-right font-mono">₹{s.agreedRate}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(s.receivedDate)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[s.status] ?? 'default'}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasPermission(PERMISSIONS.CONSIGNMENT_RETURN) &&
                      s.status === 'ACTIVE' &&
                      s.availableQty > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const qty = parseFloat(
                              prompt(`Return qty (max ${s.availableQty}):`) ?? '0'
                            );
                            if (qty > 0) returnMutation.mutate({ id: s.id, returnQty: qty });
                          }}
                        >
                          Return
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
