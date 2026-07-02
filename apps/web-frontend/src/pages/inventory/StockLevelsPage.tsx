import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stockApi, warehouseApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';

interface StockRow {
  itemId: number;
  warehouseId: number;
  itemName: string;
  itemCode: string;
  warehouseName: string;
  availableQty: string;
  reservedQty: string;
  reorderLevel: string;
  lastMovementAt?: string;
}

interface Warehouse { id: number; name: string; }

export default function StockLevelsPage() {
  const [warehouseId, setWarehouseId] = useState('');
  const [belowReorder, setBelowReorder] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-levels', warehouseId, belowReorder],
    queryFn: () => stockApi.list({
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      belowReorder: belowReorder || undefined,
    }),
  });

  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
  });

  const rows: StockRow[] = (data as { data?: StockRow[] })?.data ?? [];
  const warehouses: Warehouse[] = (whData as { data?: Warehouse[] })?.data ?? [];

  const columns = [
    { key: 'itemCode', header: 'Code', className: 'font-mono text-xs w-24' },
    { key: 'itemName', header: 'Item' },
    { key: 'warehouseName', header: 'Warehouse' },
    {
      key: 'availableQty',
      header: 'Available',
      render: (r: StockRow) => {
        const qty = parseFloat(r.availableQty);
        const reorder = parseFloat(r.reorderLevel);
        const isBelowReorder = qty <= reorder;
        return (
          <span className={`font-semibold ${isBelowReorder ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {qty.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: 'reservedQty',
      header: 'Reserved',
      render: (r: StockRow) => <span className="text-amber-600">{parseFloat(r.reservedQty).toFixed(2)}</span>,
    },
    { key: 'reorderLevel', header: 'Reorder Level', render: (r: StockRow) => parseFloat(r.reorderLevel).toFixed(2) },
    {
      key: 'status',
      header: 'Status',
      render: (r: StockRow) => {
        const qty = parseFloat(r.availableQty);
        const reorder = parseFloat(r.reorderLevel);
        return qty <= reorder
          ? <Badge variant="danger">Low Stock</Badge>
          : <Badge variant="success">OK</Badge>;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Stock Levels" subtitle="Real-time stock across all warehouses" />

      <div className="mb-4 flex gap-4 items-center">
        <div className="w-64">
          <Select
            label="Filter by Warehouse"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'All Warehouses' },
              ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
            ]}
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer mt-5">
          <input
            type="checkbox"
            checked={belowReorder}
            onChange={(e) => setBelowReorder(e.target.checked)}
            className="rounded border-gray-300 text-indigo-600"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Show only low stock items</span>
        </label>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={isLoading}
        emptyMessage="No stock data found"
      />
    </div>
  );
}
