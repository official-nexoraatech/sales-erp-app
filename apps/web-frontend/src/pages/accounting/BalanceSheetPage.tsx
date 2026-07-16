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
        <tr key={a.accountId} className="border-b border-default hover:bg-surface-raised">
          <td className="px-4 py-2 pl-8 text-sm font-mono text-xs text-disabled w-24">
            {a.accountCode}
          </td>
          <td className="px-4 py-2 text-sm text-primary">{a.accountName}</td>
          <td className="px-4 py-2 text-right font-mono text-sm text-primary">
            {formatCurrency(a.balance)}
          </td>
        </tr>
      ))}
      <tr className="bg-surface-subtle border-b-2 border-default">
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
          className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${bs.isBalanced ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
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
        <div className="bg-surface-card rounded-xl border border-default">
          <div className="px-4 py-3 border-b border-default font-semibold text-info text-sm uppercase tracking-wide">
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
          <div className="bg-surface-card rounded-xl border border-default">
            <div className="px-4 py-3 border-b border-default font-semibold text-danger text-sm uppercase tracking-wide">
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
          <div className="bg-surface-card rounded-xl border border-default">
            <div className="px-4 py-3 border-b border-default font-semibold text-brand text-sm uppercase tracking-wide">
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
