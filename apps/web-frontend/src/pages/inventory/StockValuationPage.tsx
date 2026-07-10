import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Select from '../../components/ui/Select.js';
import { stockValuationApi, warehouseApi, type StockValuationRow } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const COLUMNS: ERPColumnDef<StockValuationRow>[] = [
  { key: 'itemCode', header: 'Item Code', render: (r) => r.itemCode ?? '—' },
  { key: 'itemName', header: 'Item Name' },
  { key: 'costingMethod', header: 'Costing Method' },
  { key: 'qty', header: 'Quantity', align: 'right', mono: true, render: (r) => r.qty.toFixed(2) },
  { key: 'unitCost', header: 'Unit Cost (₹)', align: 'right', mono: true, render: (r) => fmt(r.unitCost) },
  { key: 'totalValue', header: 'Total Value (₹)', align: 'right', mono: true, render: (r) => fmt(r.totalValue) },
];

function exportCsv(rows: StockValuationRow[], totalStockValue: number, asOf: string) {
  const header = 'Item Code,Item Name,Costing Method,Quantity,Unit Cost,Total Value';
  const lines = rows.map((r) =>
    [r.itemCode ?? '', `"${r.itemName}"`, r.costingMethod, r.qty, r.unitCost, r.totalValue].join(',')
  );
  lines.push(['', '', '', '', 'TOTAL', totalStockValue].join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stock-valuation-${asOf}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface Warehouse { id: number; name: string; }

export default function StockValuationPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const today = new Date().toISOString().slice(0, 10);
  const [warehouseId, setWarehouseId] = useState('');
  const [asOf, setAsOf] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-valuation', warehouseId, asOf],
    queryFn: () => stockValuationApi.get({
      warehouseId: warehouseId ? Number(warehouseId) : undefined,
      asOf,
    }),
  });

  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });

  const rows = data ?? [];
  const totalStockValue = rows.reduce((sum, r) => sum + r.totalValue, 0);
  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];

  const footer = (
    <>
      <td className="px-3 py-2 text-primary" colSpan={5}>TOTAL STOCK VALUE</td>
      <td className="px-3 py-2 text-right font-mono">{fmt(totalStockValue)}</td>
    </>
  );

  return (
    <ERPErrorBoundary>
      <div className="space-y-4">
        <ERPPageHeader
          variant="list"
          title="Stock Valuation Report"
          subtitle="Current stock value by item (FIFO / WACC costing)"
          actions={
            <button
              onClick={() => exportCsv(rows, totalStockValue, asOf)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-default rounded-lg text-secondary hover:text-primary hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              <Download size={13} /> Export CSV
            </button>
          }
        />

        <div className="flex flex-wrap gap-3 p-4 bg-surface-card border border-default rounded-xl">
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
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">As of Date</label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="text-sm border border-default rounded-lg px-3 py-1.5 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        <ERPDataGrid<StockValuationRow>
          columns={COLUMNS}
          data={rows}
          isLoading={isLoading}
          rowKey={(r) => r.itemId}
          density="compact"
          footer={footer}
        />
      </div>
    </ERPErrorBoundary>
  );
}
