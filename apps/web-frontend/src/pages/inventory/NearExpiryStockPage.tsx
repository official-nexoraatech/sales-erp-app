import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stockApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';

interface NearExpiryRow {
  layerId: number;
  itemId: number;
  itemName: string;
  itemCode: string;
  warehouseId: number;
  warehouseName: string;
  batchNumber: string | null;
  expiryDate: string;
  remainingQty: string;
  isExpired: boolean;
}

interface Warehouse {
  id: number;
  name: string;
}

// Phase 2B (INVENTORY_BATCH capability). Visibility only — lists stock nearing or past its
// expiry date so an operator can act on it manually. This page never blocks sale, transfer,
// or adjustment of any listed stock; expiry enforcement is a deferred, future decision.
export default function NearExpiryStockPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [warehouseId, setWarehouseId] = useState('');
  const [thresholdDays, setThresholdDays] = useState('30');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    setPage(1);
  }, [warehouseId, thresholdDays]);

  const { data, isLoading } = useQuery({
    queryKey: ['near-expiry-stock', warehouseId, thresholdDays, page, pageSize],
    queryFn: () =>
      stockApi.nearExpiry({
        warehouseId: warehouseId ? Number(warehouseId) : undefined,
        thresholdDays: Number(thresholdDays),
        page,
        limit: pageSize,
      }),
  });

  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });

  const rows: NearExpiryRow[] =
    ((data as Record<string, unknown>)?.content as NearExpiryRow[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;
  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];

  const columns: ERPColumnDef<NearExpiryRow>[] = [
    { key: 'itemCode', header: 'Code', mono: true, width: 96 },
    { key: 'itemName', header: 'Item', sortable: true },
    { key: 'warehouseName', header: 'Warehouse' },
    { key: 'batchNumber', header: 'Batch', render: (r) => r.batchNumber ?? '—' },
    {
      key: 'expiryDate',
      header: 'Expiry Date',
      sortable: true,
      render: (r) => new Date(r.expiryDate).toLocaleDateString(),
    },
    {
      key: 'remainingQty',
      header: 'Remaining Qty',
      align: 'right',
      render: (r) => parseFloat(r.remainingQty).toFixed(2),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        r.isExpired ? (
          <Badge variant="danger">Expired</Badge>
        ) : (
          <Badge variant="warning">Near Expiry</Badge>
        ),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Near-Expiry Stock"
        subtitle="Batch-tracked stock nearing or past its expiry date, earliest first. Informational only — does not block sale, transfer, or adjustment of any item listed here."
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
        <div className="w-48">
          <Select
            label="Expiring Within"
            value={thresholdDays}
            onChange={(e) => setThresholdDays(e.target.value)}
            options={[
              { value: '7', label: '7 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
              { value: '365', label: '1 year' },
            ]}
          />
        </div>
      </div>

      <ERPDataGrid
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey={(r) => r.layerId}
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
