import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatCurrency } from '../../lib/format.js';

interface BSSection {
  label: string;
  total: number;
  accounts: Array<{ accountId: number; accountCode: string; accountName: string; balance: number }>;
}

interface BSData {
  asOfDate: string;
  assets: BSSection;
  liabilities: BSSection;
  equity: BSSection;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

function SectionTable({ section }: { section: BSSection }) {
  return (
    <>
      {section.accounts.map((a) => (
        <tr key={a.accountId} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
          <td className="px-4 py-2 pl-8 text-sm font-mono text-xs text-gray-400 w-24">{a.accountCode}</td>
          <td className="px-4 py-2 text-sm text-primary">{a.accountName}</td>
          <td className="px-4 py-2 text-right font-mono text-sm text-primary">{formatCurrency(a.balance)}</td>
        </tr>
      ))}
      <tr className="bg-gray-50 dark:bg-gray-900/30 border-b-2 border-gray-300 dark:border-gray-600">
        <td className="px-4 py-2.5 text-sm font-semibold text-primary" colSpan={2}>{section.label} Total</td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary">{formatCurrency(section.total)}</td>
      </tr>
    </>
  );
}

export default function BalanceSheetPage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().substring(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['balance-sheet', asOfDate],
    queryFn: () => reportsApi.balanceSheet({ asOfDate }),
  });

  const bs: BSData | undefined = (data as { data?: BSData })?.data;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Balance Sheet"
        subtitle="Assets = Liabilities + Equity"
        actions={
          <div className="flex items-center gap-3">
            <label className="text-sm text-secondary">As of</label>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary" />
          </div>
        }
      />

      {bs && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${bs.isBalanced ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
          {bs.isBalanced ? '✓ Balance sheet balances' : '⚠ Balance sheet does NOT balance'}
          <span className="ml-auto font-normal text-secondary">Assets: {formatCurrency(bs.assets.total)} | L+E: {formatCurrency(bs.totalLiabilitiesAndEquity)}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Assets */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-blue-700 dark:text-blue-400 text-sm uppercase tracking-wide">Assets</div>
          {isLoading ? <ERPTableSkeleton rows={6} /> : bs ? (
            <table className="w-full"><tbody><SectionTable section={bs.assets} /></tbody></table>
          ) : null}
        </div>

        {/* Liabilities + Equity */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-red-700 dark:text-red-400 text-sm uppercase tracking-wide">Liabilities</div>
            {isLoading ? <ERPTableSkeleton rows={4} /> : bs ? (
              <table className="w-full"><tbody><SectionTable section={bs.liabilities} /></tbody></table>
            ) : null}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-indigo-700 dark:text-indigo-400 text-sm uppercase tracking-wide">Equity</div>
            {isLoading ? <ERPTableSkeleton rows={3} /> : bs ? (
              <table className="w-full"><tbody><SectionTable section={bs.equity} /></tbody></table>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
