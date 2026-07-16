import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { journalApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import DatePicker from '../../components/ui/DatePicker.js';
import Button from '../../components/ui/Button.js';
import { formatCurrency, formatDatetime } from '../../lib/format.js';

interface LedgerTx {
  id: number;
  journalId: string;
  description: string;
  referenceType?: string;
  referenceId?: number;
  debitAmount: string;
  creditAmount: string;
  transactionDate: string;
  runningBalance: string;
}

interface LedgerData {
  accountId: number;
  accountCode: string;
  accountName: string;
  normalBalance: string;
  fromDate: string;
  toDate: string;
  transactions: LedgerTx[];
  totalElements: number;
}

export default function LedgerPage() {
  const { id } = useParams<{ id: string }>();
  const today = new Date().toISOString().substring(0, 10);
  const fyStart = `${new Date().getFullYear()}-04-01`;

  const [fromDate, setFromDate] = useState(fyStart);
  const [toDate, setToDate] = useState(today);
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['ledger', id, fromDate, toDate, page],
    queryFn: () =>
      journalApi.getLedger(Number(id), {
        fromDate,
        toDate,
        page: String(page),
        size: '50',
      }),
    enabled: !!id,
  });

  const ledger: LedgerData | undefined = data as LedgerData;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title={ledger ? `${ledger.accountCode} — ${ledger.accountName}` : 'Account Ledger'}
        subtitle="Transaction history"
      />

      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <DatePicker
            label="From"
            value={fromDate}
            onChange={(v) => {
              setFromDate(v);
              setPage(0);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <DatePicker
            label="To"
            value={toDate}
            onChange={(v) => {
              setToDate(v);
              setPage(0);
            }}
          />
        </div>
        {ledger && (
          <span className="text-sm text-secondary self-center">
            {ledger.totalElements} transaction(s)
          </span>
        )}
      </div>

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={10} />
        ) : !ledger || ledger.transactions.length === 0 ? (
          <ERPEmptyState
            type="no-results"
            title="No transactions in this period"
            description="Try adjusting the date range above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle border-b border-default">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Journal</th>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Description</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Debit</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Credit</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {ledger.transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-surface-raised">
                    <td className="px-4 py-2.5 text-secondary text-xs">
                      {formatDatetime(tx.transactionDate)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-link">
                      {tx.journalId.slice(0, 16)}…
                    </td>
                    <td className="px-4 py-2.5 text-primary max-w-xs truncate">{tx.description}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-success">
                      {Number(tx.debitAmount) > 0 ? formatCurrency(Number(tx.debitAmount)) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-danger">
                      {Number(tx.creditAmount) > 0 ? formatCurrency(Number(tx.creditAmount)) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-primary">
                      {formatCurrency(Number(tx.runningBalance))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(ledger?.totalElements ?? 0) > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-default">
            <span className="text-sm text-secondary">Page {page + 1}</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page + 1) * 50 >= (ledger?.totalElements ?? 0)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
