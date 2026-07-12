import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { journalApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatDatetime, formatCurrency } from '../../lib/format.js';

interface Journal {
  journalId: string;
  description: string;
  status: string;
  referenceType?: string;
  referenceId?: number;
  totalDebit?: string;
  totalCredit?: string;
  createdAt: string;
  reversedBy?: string;
}

const STATUS_COLORS: Record<string, 'green' | 'gray' | 'red' | 'yellow'> = {
  POSTED: 'green',
  REVERSED: 'red',
  DRAFT: 'yellow',
};

export default function JournalsPage() {
  const navigate = useNavigate();
  const canCreateJournal = useAuthStore((s) => s.hasPermission(PERMISSIONS.JOURNAL_CREATE));
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['journals', page],
    queryFn: () => journalApi.list({ page: String(page), size: '20' }),
  });

  const journals: Journal[] = (data as { content?: Journal[] })?.content ?? [];
  const total: number = (data as { totalElements?: number })?.totalElements ?? 0;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Journal Entries"
        subtitle={`${total} journal(s) total`}
        actions={
          canCreateJournal ? (
            <Button variant="primary" onClick={() => navigate('/accounting/journals/new')}>
              + Manual Journal
            </Button>
          ) : undefined
        }
      />

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <ERPTableSkeleton rows={8} />
        ) : journals.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No journal entries yet"
            description="Journal entries are posted automatically from business events. You can also add one manually."
            {...(canCreateJournal
              ? {
                  action: {
                    label: '+ Manual Journal',
                    onClick: () => navigate('/accounting/journals/new'),
                  },
                }
              : {})}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Journal ID</th>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Description</th>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Reference</th>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-secondary">Amount (DR)</th>
                  <th className="px-4 py-3 text-left font-medium text-secondary">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {journals.map((j) => (
                  <tr
                    key={j.journalId}
                    className="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer"
                    onClick={() => navigate(`/accounting/journals/${j.journalId}`)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-400">
                      {j.journalId.slice(0, 20)}…
                    </td>
                    <td className="px-4 py-3 text-primary max-w-xs truncate">{j.description}</td>
                    <td className="px-4 py-3 text-secondary text-xs">
                      {j.referenceType} {j.referenceId ? `#${j.referenceId}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={j.status} color={STATUS_COLORS[j.status] ?? 'gray'} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatCurrency(Number(j.totalDebit ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-secondary text-xs">
                      {formatDatetime(j.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 20 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <span className="text-sm text-secondary">Page {page + 1}</span>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <Button
                variant="ghost"
                disabled={(page + 1) * 20 >= total}
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
