import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Badge from '../../components/ui/Badge.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatCurrency } from '../../lib/format.js';

interface TBRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}

interface TBData {
  asOfDate: string;
  rows: TBRow[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}

export default function TrialBalancePage() {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().substring(0, 10));

  const { data, isLoading } = useQuery({
    queryKey: ['trial-balance', asOfDate],
    queryFn: () => reportsApi.trialBalance({ asOfDate }),
  });

  const tb: TBData | undefined = (data as { data?: TBData })?.data;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Trial Balance"
        subtitle="Debit and credit totals by account"
        actions={
          <div className="flex items-center gap-3">
            <label className="text-sm text-secondary">As of</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-primary"
            />
          </div>
        }
      />

      {tb && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${tb.isBalanced ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
          {tb.isBalanced ? '✓ Trial balance is balanced' : `⚠ Trial balance does NOT balance — difference: ${formatCurrency(Math.abs(tb.totalDebits - tb.totalCredits))}`}
          <span className="ml-auto text-secondary font-normal">Total DR: {formatCurrency(tb.totalDebits)} / Total CR: {formatCurrency(tb.totalCredits)}</span>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <ERPTableSkeleton rows={12} />
        ) : !tb?.rows.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">⚖️</div>
            <p className="text-primary font-medium">No data for this period</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-secondary">Code</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Account Name</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Type</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Opening DR</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Opening CR</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Period DR</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Period CR</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Closing DR</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Closing CR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {tb.rows.map((row) => (
                <tr key={row.accountId} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{row.accountCode}</td>
                  <td className="px-4 py-2.5 text-primary">{row.accountName}</td>
                  <td className="px-4 py-2.5"><Badge label={row.accountType} color="gray" /></td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(row.openingDebit)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(row.openingCredit)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(row.periodDebit)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(row.periodCredit)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(row.closingDebit)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(row.closingCredit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-900/40 border-t-2 border-gray-300 dark:border-gray-600">
              <tr>
                <td colSpan={7} className="px-4 py-3 font-semibold text-primary">TOTAL</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-primary">{formatCurrency(tb.totalDebits)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-primary">{formatCurrency(tb.totalCredits)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
