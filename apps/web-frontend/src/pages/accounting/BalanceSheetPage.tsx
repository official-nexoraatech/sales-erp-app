import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import DatePicker from '../../components/ui/DatePicker.js';
import { formatCurrency } from '../../lib/format.js';

interface BSAccountRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  balance: number;
}

interface BSData {
  asOf: string;
  assets: BSAccountRow[];
  totalAssets: number;
  liabilities: BSAccountRow[];
  totalLiabilities: number;
  equity: BSAccountRow[];
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

function SectionTable({
  accounts,
  label,
  total,
}: {
  accounts: BSAccountRow[];
  label: string;
  total: number;
}) {
  return (
    <>
      {accounts.map((a) => (
        <tr
          key={a.accountId}
          className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
        >
          <td className="px-4 py-2 pl-8 text-sm font-mono text-xs text-disabled w-24">
            {a.accountCode}
          </td>
          <td className="px-4 py-2 text-sm text-primary">{a.accountName}</td>
          <td className="px-4 py-2 text-right font-mono text-sm text-primary">
            {formatCurrency(a.balance)}
          </td>
        </tr>
      ))}
      <tr className="bg-gray-50 dark:bg-gray-900/30 border-b-2 border-gray-300 dark:border-gray-600">
        <td className="px-4 py-2.5 text-sm font-semibold text-primary" colSpan={2}>
          {label} Total
        </td>
        <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary">
          {formatCurrency(total)}
        </td>
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

  const bs: BSData | undefined = data as BSData;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Balance Sheet"
        subtitle="Assets = Liabilities + Equity"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <DatePicker label="As of" value={asOfDate} onChange={setAsOfDate} />
          </div>
        }
      />

      {bs && (
        <div
          className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${bs.isBalanced ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}
        >
          {bs.isBalanced ? '✓ Balance sheet balances' : '⚠ Balance sheet does NOT balance'}
          <span className="ml-auto font-normal text-secondary">
            Assets: {formatCurrency(bs.totalAssets)} | L+E:{' '}
            {formatCurrency(bs.totalLiabilitiesAndEquity)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Assets */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-blue-700 dark:text-blue-400 text-sm uppercase tracking-wide">
            Assets
          </div>
          {isLoading ? (
            <ERPTableSkeleton rows={6} />
          ) : bs ? (
            <table className="w-full">
              <tbody>
                <SectionTable accounts={bs.assets} label="Assets" total={bs.totalAssets} />
              </tbody>
            </table>
          ) : null}
        </div>

        {/* Liabilities + Equity */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-red-700 dark:text-red-400 text-sm uppercase tracking-wide">
              Liabilities
            </div>
            {isLoading ? (
              <ERPTableSkeleton rows={4} />
            ) : bs ? (
              <table className="w-full">
                <tbody>
                  <SectionTable
                    accounts={bs.liabilities}
                    label="Liabilities"
                    total={bs.totalLiabilities}
                  />
                </tbody>
              </table>
            ) : null}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-indigo-700 dark:text-indigo-400 text-sm uppercase tracking-wide">
              Equity
            </div>
            {isLoading ? (
              <ERPTableSkeleton rows={3} />
            ) : bs ? (
              <table className="w-full">
                <tbody>
                  <SectionTable accounts={bs.equity} label="Equity" total={bs.totalEquity} />
                </tbody>
              </table>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
