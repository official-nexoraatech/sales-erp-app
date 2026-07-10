import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatCurrency } from '../../lib/format.js';

interface PLData {
  fromDate: string;
  toDate: string;
  revenue: number;
  salesReturns: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  opEx: number;
  operatingProfit: number;
  otherIncome: number;
  financialCharges: number;
  netProfit: number;
}

function PLRow({ label, amount, indent = 0, bold = false, highlight }: { label: string; amount: number; indent?: number; bold?: boolean; highlight?: 'profit' | 'loss' }) {
  const colorClass = highlight === 'profit' ? 'text-green-600 dark:text-green-400' : highlight === 'loss' ? 'text-red-600 dark:text-red-400' : 'text-primary';
  return (
    <tr className={`border-b border-gray-100 dark:border-gray-700 ${bold ? 'bg-gray-50 dark:bg-gray-900/30' : ''}`}>
      <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + indent * 24}px` }}>
        <span className={`text-sm ${bold ? 'font-semibold' : ''} ${colorClass}`}>{label}</span>
      </td>
      <td className={`px-4 py-2.5 text-right font-mono text-sm ${bold ? 'font-semibold' : ''} ${colorClass}`}>
        {formatCurrency(amount)}
      </td>
    </tr>
  );
}

export default function ProfitLossPage() {
  const now = new Date();
  const fyStart = `${now.getFullYear()}-04-01`;
  const today = now.toISOString().substring(0, 10);

  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(today);

  const { data, isLoading } = useQuery({
    queryKey: ['profit-loss', fromDate, toDate],
    queryFn: () => reportsApi.profitLoss({ fromDate, toDate }),
    enabled: !!fromDate && !!toDate,
  });

  const pl: PLData | undefined = (data as PLData);

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Profit & Loss Statement"
        subtitle="Income and expense summary"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary" />
            <span className="text-secondary text-sm">to</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary" />
          </div>
        }
      />

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <ERPTableSkeleton rows={10} />
        ) : !pl ? (
          <div className="flex items-center justify-center py-16"><p className="text-secondary">Select a date range to view the P&L</p></div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-secondary">Particulars</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              <PLRow label="Revenue from Operations" amount={pl.revenue} bold />
              <PLRow label="Less: Sales Returns" amount={-pl.salesReturns} indent={1} />
              <PLRow label="Net Revenue" amount={pl.netRevenue} bold highlight={pl.netRevenue >= 0 ? 'profit' : 'loss'} />
              <tr><td colSpan={2} className="h-2" /></tr>
              <PLRow label="Cost of Goods Sold (COGS)" amount={pl.cogs} bold />
              <PLRow label="Gross Profit" amount={pl.grossProfit} bold highlight={pl.grossProfit >= 0 ? 'profit' : 'loss'} />
              <tr><td colSpan={2} className="h-2" /></tr>
              <PLRow label="Operating Expenses" amount={pl.opEx} bold />
              <PLRow label="Operating Profit (EBIT)" amount={pl.operatingProfit} bold highlight={pl.operatingProfit >= 0 ? 'profit' : 'loss'} />
              <tr><td colSpan={2} className="h-2" /></tr>
              <PLRow label="Other Income" amount={pl.otherIncome} indent={1} />
              <PLRow label="Financial Charges" amount={-pl.financialCharges} indent={1} />
              <tr><td colSpan={2} className="h-px bg-gray-200 dark:bg-gray-600" /></tr>
              <PLRow label="Net Profit / (Loss)" amount={pl.netProfit} bold highlight={pl.netProfit >= 0 ? 'profit' : 'loss'} />
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
