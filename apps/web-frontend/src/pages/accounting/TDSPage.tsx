import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tdsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
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

  const liability: LiabilityData | undefined = (liabData as { data?: LiabilityData })?.data;
  const q26: Q26Data | undefined = (q26Data as { data?: Q26Data })?.data;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="TDS Management"
        subtitle="Tax Deducted at Source — Sections 194C / 194H / 194J"
      />

      {/* Monthly Liability */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <h3 className="font-semibold text-primary">Monthly Liability</h3>
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary"
          />
        </div>
        {liabLoading ? (
          <ERPTableSkeleton rows={2} />
        ) : liability ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{formatCurrency(liability.totalLiability)}</div>
              <div className="text-sm text-secondary mt-1">TDS Payable for {period}</div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{liability.entryCount}</div>
              <div className="text-sm text-secondary mt-1">Pending TDS Entries</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/30 rounded-xl p-4 flex items-center justify-center">
              <div className="text-sm text-secondary text-center">Deposit TDS by 7th of next month to avoid interest u/s 201(1A)</div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 26Q Return */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <h3 className="font-semibold text-primary">26Q Quarterly Return</h3>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2020}
            max={2030}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary w-24"
          />
          <select
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary"
          >
            <option value={1}>Q1 (Apr–Jun)</option>
            <option value={2}>Q2 (Jul–Sep)</option>
            <option value={3}>Q3 (Oct–Dec)</option>
            <option value={4}>Q4 (Jan–Mar)</option>
          </select>
        </div>

        {q26Loading ? (
          <ERPTableSkeleton rows={4} />
        ) : !q26?.entries.length ? (
          <div className="flex items-center justify-center py-8 text-secondary text-sm">No TDS deductions in this quarter</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-secondary">PAN</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Supplier</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Section</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Gross Amount</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">TDS Amount</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {q26.entries.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-2.5 font-mono text-xs">{row.pan}</td>
                  <td className="px-4 py-2.5 text-primary">{row.supplierName}</td>
                  <td className="px-4 py-2.5 text-secondary">{row.section}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(row.grossAmount)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-600 dark:text-red-400">{formatCurrency(row.tdsAmount)}</td>
                  <td className="px-4 py-2.5 text-secondary text-xs">{row.dateOfPayment}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-900/40 border-t border-gray-200 dark:border-gray-700">
              <tr>
                <td colSpan={3} className="px-4 py-3 font-semibold text-primary">Total</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">{formatCurrency(q26.entries.reduce((s, r) => s + r.grossAmount, 0))}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-red-600">{formatCurrency(q26.entries.reduce((s, r) => s + r.tdsAmount, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
