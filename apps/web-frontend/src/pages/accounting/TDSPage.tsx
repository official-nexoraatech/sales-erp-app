import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tdsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import { formatCurrency } from '../../lib/format.js';

interface LiabilityData {
  period: string;
  totalLiability: number;
  entryCount: number;
}

interface Q26Row {
  pan: string;
  supplierName: string;
  section: string;
  grossAmount: number;
  tdsAmount: number;
  dateOfPayment: string;
}

interface Q26Data {
  period: string;
  entries: Q26Row[];
}

export default function TDSPage() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(1);

  const { data: liabData, isLoading: liabLoading } = useQuery({
    queryKey: ['tds-liability', period],
    queryFn: () => tdsApi.getLiability({ period }),
  });

  const { data: q26Data, isLoading: q26Loading } = useQuery({
    queryKey: ['tds-26q', year, quarter],
    queryFn: () => tdsApi.get26Q({ year, quarter }),
  });

  const liability: LiabilityData | undefined = (liabData as LiabilityData);
  const q26: Q26Data | undefined = (q26Data as Q26Data);

  const q26Columns: ERPColumnDef<Q26Row>[] = [
    { key: 'pan', header: 'PAN', mono: true, className: 'text-xs' },
    { key: 'supplierName', header: 'Supplier' },
    { key: 'section', header: 'Section', className: 'text-secondary' },
    { key: 'grossAmount', header: 'Gross Amount', align: 'right', mono: true, render: (row) => formatCurrency(row.grossAmount) },
    { key: 'tdsAmount', header: 'TDS Amount', align: 'right', mono: true, className: 'text-danger', render: (row) => formatCurrency(row.tdsAmount) },
    { key: 'dateOfPayment', header: 'Date', className: 'text-secondary text-xs' },
  ];

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="TDS Management"
        subtitle="Tax Deducted at Source — Sections 194C / 194H / 194J"
      />

      {/* Monthly Liability */}
      <div className="bg-surface-card rounded-xl border border-default p-4">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <h3 className="font-semibold text-primary">Monthly Liability</h3>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border border-default rounded-lg px-3 py-1.5 text-sm bg-surface-card text-primary outline-none focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus"
          />
        </div>
        {liabLoading ? (
          <ERPTableSkeleton rows={2} />
        ) : liability ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-danger-bg rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-danger">{formatCurrency(liability.totalLiability)}</div>
              <div className="text-sm text-secondary mt-1">TDS Payable for {period}</div>
            </div>
            <div className="bg-info-bg rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-info">{liability.entryCount}</div>
              <div className="text-sm text-secondary mt-1">Pending TDS Entries</div>
            </div>
            <div className="bg-surface-subtle rounded-xl p-4 flex items-center justify-center">
              <div className="text-sm text-secondary text-center">Deposit TDS by 7th of next month to avoid interest u/s 201(1A)</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 26Q Return */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <h3 className="font-semibold text-primary">26Q Quarterly Return</h3>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2020}
            max={2030}
            className="border border-default rounded-lg px-3 py-1.5 text-sm bg-surface-card text-primary w-24 outline-none focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus"
          />
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
            className="border border-default rounded-lg px-3 py-1.5 text-sm bg-surface-card text-primary outline-none focus:border-focus focus:ring-2 focus:ring-inset focus:ring-focus"
          >
            <option value={1}>Q1 (Apr–Jun)</option>
            <option value={2}>Q2 (Jul–Sep)</option>
            <option value={3}>Q3 (Oct–Dec)</option>
            <option value={4}>Q4 (Jan–Mar)</option>
          </select>
        </div>

        <ERPDataGrid
          columns={q26Columns}
          data={q26?.entries ?? []}
          isLoading={q26Loading}
          rowKey={(r) => `${r.pan}-${r.section}-${r.dateOfPayment}`}
          emptyState={<ERPEmptyState type="no-results" title="No TDS deductions in this quarter" description="Try selecting a different year or quarter." />}
          footer={
            q26 && q26.entries.length > 0 && (
              <>
                <td colSpan={3} className="px-4 py-3 text-primary">Total</td>
                <td className="px-4 py-3 text-right font-mono text-primary">{formatCurrency(q26.entries.reduce((s, r) => s + r.grossAmount, 0))}</td>
                <td className="px-4 py-3 text-right font-mono text-danger">{formatCurrency(q26.entries.reduce((s, r) => s + r.tdsAmount, 0))}</td>
                <td />
              </>
            )
          }
        />
      </div>
    </div>
  );
}
