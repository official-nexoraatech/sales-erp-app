import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPErrorBoundary from '../../components/erp/ERPErrorBoundary.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { arAgingApi, type AgingRow } from '../../api/endpoints.js';

function fmt(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

const COLUMNS: ERPColumnDef<AgingRow>[] = [
  { key: 'customerName', header: 'Customer Name', render: (r) => r.customerName ?? '—' },
  { key: 'days0to30', header: '0–30 Days (₹)', align: 'right', mono: true, render: (r) => fmt(Number(r.days0to30)) },
  { key: 'days31to60', header: '31–60 Days (₹)', align: 'right', mono: true, render: (r) => fmt(Number(r.days31to60)) },
  { key: 'days61to90', header: '61–90 Days (₹)', align: 'right', mono: true, render: (r) => fmt(Number(r.days61to90)) },
  { key: 'days90plus', header: '90+ Days (₹)', align: 'right', mono: true, render: (r) => fmt(Number(r.days90plus)) },
  { key: 'totalOutstanding', header: 'Total Outstanding (₹)', align: 'right', mono: true, render: (r) => fmt(Number(r.totalOutstanding)) },
];

function totals(rows: AgingRow[]) {
  return rows.reduce(
    (acc, r) => ({
      days0to30: acc.days0to30 + Number(r.days0to30),
      days31to60: acc.days31to60 + Number(r.days31to60),
      days61to90: acc.days61to90 + Number(r.days61to90),
      days90plus: acc.days90plus + Number(r.days90plus),
      totalOutstanding: acc.totalOutstanding + Number(r.totalOutstanding),
    }),
    { days0to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOutstanding: 0 }
  );
}

function exportCsv(rows: AgingRow[], asOf: string) {
  const header = 'Customer Name,0-30 Days,31-60 Days,61-90 Days,90+ Days,Total Outstanding';
  const t = totals(rows);
  const lines = rows.map((r) =>
    [r.customerName ?? '', r.days0to30, r.days31to60, r.days61to90, r.days90plus, r.totalOutstanding].join(',')
  );
  lines.push(['TOTAL', t.days0to30, t.days31to60, t.days61to90, t.days90plus, t.totalOutstanding].join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ar-aging-${asOf}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ArAgingPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(today);
  const [branchId, setBranchId] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ar-aging', asOf, branchId],
    queryFn: () => arAgingApi.get(asOf, branchId || undefined),
  });

  const rows = data ?? [];
  const t = totals(rows);

  const footer = (
    <>
      <td className="px-3 py-2 text-primary">TOTAL</td>
      <td className="px-3 py-2 text-right font-mono">{fmt(t.days0to30)}</td>
      <td className="px-3 py-2 text-right font-mono">{fmt(t.days31to60)}</td>
      <td className="px-3 py-2 text-right font-mono">{fmt(t.days61to90)}</td>
      <td className="px-3 py-2 text-right font-mono">{fmt(t.days90plus)}</td>
      <td className="px-3 py-2 text-right font-mono">{fmt(t.totalOutstanding)}</td>
    </>
  );

  return (
    <ERPErrorBoundary>
      <div className="space-y-4">
        <ERPPageHeader
          variant="list"
          title="AR Aging Summary"
          subtitle="Customer outstanding invoices by overdue period"
          actions={
            <button
              onClick={() => exportCsv(rows, asOf)}
              disabled={rows.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-default rounded-lg text-secondary hover:text-primary hover:bg-surface-raised transition-colors disabled:opacity-40"
            >
              <Download size={13} /> Export CSV
            </button>
          }
        />

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 p-4 bg-surface-card border border-default rounded-xl">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">As of Date</label>
            <input
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="text-sm border border-default rounded-lg px-3 py-1.5 bg-surface-card text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Branch ID</label>
            <input
              type="number"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              placeholder="All branches"
              className="text-sm border border-default rounded-lg px-3 py-1.5 bg-surface-card text-primary placeholder-secondary focus:outline-none focus:ring-2 focus:ring-primary/30 w-36"
            />
          </div>
        </div>

        <ERPDataGrid<AgingRow>
          columns={COLUMNS}
          data={rows}
          isLoading={isLoading}
          rowKey={(r) => r.customerName ?? Math.random()}
          density="compact"
          footer={footer}
        />
      </div>
    </ERPErrorBoundary>
  );
}
