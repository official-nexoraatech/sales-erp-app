import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Badge from '../../components/ui/Badge.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import DatePicker from '../../components/ui/DatePicker.js';
import { formatCurrency } from '../../lib/format.js';

interface TBRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalance: number;
  openingBalanceType: 'DEBIT' | 'CREDIT';
  periodDebits: number;
  periodCredits: number;
  closingDebit: number;
  closingCredit: number;
}

interface TBData {
  asOf: string;
  lines: TBRow[];
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

  const tb: TBData | undefined = data as TBData;

  const columns: ERPColumnDef<TBRow>[] = [
    {
      key: 'accountCode',
      header: 'Code',
      mono: true,
      className: 'text-xs text-disabled',
      hideable: false,
    },
    { key: 'accountName', header: 'Account Name' },
    {
      key: 'accountType',
      header: 'Type',
      render: (row) => <Badge label={row.accountType} color="gray" />,
    },
    {
      key: 'openingDebit',
      header: 'Opening DR',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.openingBalanceType === 'DEBIT' ? row.openingBalance : 0),
    },
    {
      key: 'openingCredit',
      header: 'Opening CR',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.openingBalanceType === 'CREDIT' ? row.openingBalance : 0),
    },
    {
      key: 'periodDebit',
      header: 'Period DR',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.periodDebits),
    },
    {
      key: 'periodCredit',
      header: 'Period CR',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(row.periodCredits),
    },
    {
      key: 'closingDebit',
      header: 'Closing DR',
      align: 'right',
      mono: true,
      className: 'font-semibold',
      render: (row) => formatCurrency(row.closingDebit),
    },
    {
      key: 'closingCredit',
      header: 'Closing CR',
      align: 'right',
      mono: true,
      className: 'font-semibold',
      render: (row) => formatCurrency(row.closingCredit),
    },
  ];

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Trial Balance"
        subtitle="Debit and credit totals by account"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <DatePicker label="As of" value={asOfDate} onChange={setAsOfDate} />
          </div>
        }
      />

      {tb && (
        <div
          className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${tb.isBalanced ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
        >
          {tb.isBalanced
            ? '✓ Trial balance is balanced'
            : `⚠ Trial balance does NOT balance — difference: ${formatCurrency(Math.abs(tb.totalDebits - tb.totalCredits))}`}
          <span className="ml-auto text-secondary font-normal">
            Total DR: {formatCurrency(tb.totalDebits)} / Total CR: {formatCurrency(tb.totalCredits)}
          </span>
        </div>
      )}

      <ERPDataGrid
        columns={columns}
        data={tb?.lines ?? []}
        isLoading={isLoading}
        rowKey="accountId"
        emptyState={
          <ERPEmptyState
            type="no-results"
            title="No data for this period"
            description="Try selecting a different date."
          />
        }
        footer={
          tb && (
            <>
              <td colSpan={7} className="px-4 py-3 text-primary">
                TOTAL
              </td>
              <td className="px-4 py-3 text-right font-mono text-primary">
                {formatCurrency(tb.totalDebits)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-primary">
                {formatCurrency(tb.totalCredits)}
              </td>
            </>
          )
        }
      />
    </div>
  );
}
