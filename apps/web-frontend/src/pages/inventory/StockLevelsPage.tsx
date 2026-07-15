import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stockApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';
import Checkbox from '../../components/ui/Checkbox.js';

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

interface Warehouse {
  id: number;
  name: string;
}

export default function StockLevelsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [warehouseId, setWarehouseId] = useState('');
  const [belowReorder, setBelowReorder] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    setPage(1);
  }, [warehouseId, belowReorder]);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-levels', warehouseId, belowReorder, page, pageSize],
    queryFn: () =>
      stockApi.list({
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
        belowReorder: belowReorder || undefined,
        page,
        limit: pageSize,
      }),
  });

  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });

  const rows: StockRow[] = ((data as Record<string, unknown>)?.content as StockRow[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;
  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];

  const columns: ERPColumnDef<StockRow>[] = [
    { key: 'itemCode', header: 'Code', mono: true, width: 96 },
    { key: 'itemName', header: 'Item', sortable: true },
    { key: 'warehouseName', header: 'Warehouse' },
    {
      key: 'availableQty',
      header: 'Available',
      align: 'right',
      sortable: true,
      render: (r) => {
        const qty = parseFloat(r.availableQty);
        const reorder = parseFloat(r.reorderLevel);
        const isBelowReorder = qty <= reorder;
        return (
          <span className={`font-semibold ${isBelowReorder ? 'text-danger' : 'text-primary'}`}>
            {qty.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: 'reservedQty',
      header: 'Reserved',
      align: 'right',
      render: (r) => <span className="text-warning">{parseFloat(r.reservedQty).toFixed(2)}</span>,
    },
    {
      key: 'reorderLevel',
      header: 'Reorder Level',
      align: 'right',
      render: (r) => parseFloat(r.reorderLevel).toFixed(2),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const qty = parseFloat(r.availableQty);
        const reorder = parseFloat(r.reorderLevel);
        return qty <= reorder ? (
          <Badge variant="danger">Low Stock</Badge>
        ) : (
          <Badge variant="success">OK</Badge>
        );
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Stock Levels"
        subtitle="Real-time stock across all warehouses"
      />

      <div className="mb-4 flex flex-wrap gap-4 items-center">
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
        <div className="mt-5">
          <Checkbox
            label="Show only low stock items"
            checked={belowReorder}
            onChange={(e) => setBelowReorder(e.target.checked)}
          />
        </div>
      </div>

      <ERPDataGrid
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey={(r) => `${r.itemId}-${r.warehouseId}`}
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
