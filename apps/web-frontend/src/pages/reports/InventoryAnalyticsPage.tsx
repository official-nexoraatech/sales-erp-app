import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { reportsEngineApi } from '../../api/endpoints.js';

interface InventoryAnalyticsRow {
  itemCode: string | null;
  itemName: string;
  category: string | null;
  currentStock: number | string;
  daysOfSupply: number | string | null;
  lastSaleDate: string | null;
  status: 'STOCKOUT' | 'FAST' | 'SLOW';
}

const STATUS_STYLES: Record<string, string> = {
  STOCKOUT: 'bg-error-bg text-error',
  FAST: 'bg-success-bg text-success',
  SLOW: 'bg-warning-bg text-warning',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}>
      {status}
    </span>
  );
}

const COLUMNS: ERPColumnDef<InventoryAnalyticsRow>[] = [
  { key: 'itemCode', header: 'Item Code', render: (r) => r.itemCode ?? '—' },
  { key: 'itemName', header: 'Item' },
  { key: 'category', header: 'Category', render: (r) => r.category ?? 'Uncategorized' },
  {
    key: 'currentStock',
    header: 'Current Stock',
    align: 'right',
    mono: true,
    render: (r) => Number(r.currentStock).toLocaleString('en-IN'),
  },
  {
    key: 'daysOfSupply',
    header: 'Days of Supply',
    align: 'right',
    mono: true,
    render: (r) =>
      r.daysOfSupply === null || r.daysOfSupply === undefined
        ? '—'
        : Number(r.daysOfSupply).toFixed(1),
  },
  { key: 'lastSaleDate', header: 'Last Sale', render: (r) => r.lastSaleDate ?? 'Never' },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
];

export default function InventoryAnalyticsPage() {
  const [fastMoverThreshold, setFastMoverThreshold] = useState('10');

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-analytics', fastMoverThreshold],
    queryFn: async () =>
      (await reportsEngineApi.run('inventory-analytics', { fastMoverThreshold })) as {
        rows: InventoryAnalyticsRow[];
      },
  });

  const rows = data?.rows ?? [];
  const stockoutCount = rows.filter((r) => r.status === 'STOCKOUT').length;

  return (
    <ERPErrorBoundary>
      <div className="space-y-4">
        <ERPPageHeader
          variant="list"
          title="Inventory Analytics"
          subtitle="Stock levels, days of supply and fast/slow/stockout classification"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-secondary" htmlFor="fast-mover-threshold">
                Fast mover threshold (units/30d)
              </label>
              <input
                id="fast-mover-threshold"
                type="number"
                min={0}
                value={fastMoverThreshold}
                onChange={(e) => setFastMoverThreshold(e.target.value)}
                className="text-sm border border-default rounded-lg px-3 py-1.5 bg-surface-card text-primary w-20 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          }
        />

        {stockoutCount > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-error-bg bg-error-bg text-error text-sm">
            <AlertTriangle size={16} />
            {stockoutCount} item{stockoutCount === 1 ? '' : 's'} out of stock
          </div>
        )}

        <ERPDataGrid<InventoryAnalyticsRow>
          columns={COLUMNS}
          data={rows}
          isLoading={isLoading}
          rowKey={(r) => `${r.itemCode ?? ''}-${r.itemName}`}
          density="compact"
        />
      </div>
    </ERPErrorBoundary>
  );
}
