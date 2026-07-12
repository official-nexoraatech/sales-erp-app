import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { journalApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPConfirmModal from '../../components/erp/ERPConfirmModal.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDatetime, formatCurrency } from '../../lib/format.js';

interface JournalLine {
  id: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  debitAmount: string;
  creditAmount: string;
  description?: string;
  narration?: string;
  costCenterId?: number;
}

interface JournalDetail {
  journalId: string;
  description: string;
  status: 'POSTED' | 'REVERSED';
  referenceType?: string;
  referenceId?: number;
  reversalOf?: string;
  reversedBy?: string;
  isReversal: boolean;
  totalDebit?: string;
  totalCredit?: string;
  postedAt: string;
  createdAt: string;
  lines: JournalLine[];
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  POSTED: 'success',
  REVERSED: 'danger',
};

export default function JournalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canReverse = hasPermission(PERMISSIONS.CANCEL_POSTED_JOURNAL);
  const [showReverseConfirm, setShowReverseConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['journal', id],
    queryFn: () => journalApi.getById(id as string),
    enabled: !!id,
  });

  const j = data as JournalDetail | undefined;

  const reverseMutation = useMutation({
    mutationFn: () => journalApi.reverse(id as string, {}),
    onSuccess: () => {
      toast.success('Journal reversed');
      void qc.invalidateQueries({ queryKey: ['journal', id] });
      void qc.invalidateQueries({ queryKey: ['journals'] });
      setShowReverseConfirm(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setShowReverseConfirm(false);
    },
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!j) return <ERPEmptyState type="no-data" title="Journal not found" />;

  const totalDebit = j.lines.reduce((sum, l) => sum + parseFloat(l.debitAmount || '0'), 0);
  const totalCredit = j.lines.reduce((sum, l) => sum + parseFloat(l.creditAmount || '0'), 0);

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={j.journalId}
        entityType="Journal"
        entityNumber={j.journalId}
        status={j.status}
        backTo="/accounting/journals"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_VARIANT[j.status] ?? 'default'}>{j.status}</Badge>
          {canReverse && j.status === 'POSTED' && !j.isReversal && (
            <Button variant="danger" onClick={() => setShowReverseConfirm(true)}>
              Reverse
            </Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Description', value: j.description },
          {
            label: 'Reference',
            value: j.referenceType
              ? `${j.referenceType}${j.referenceId ? ` #${j.referenceId}` : ''}`
              : '—',
          },
          { label: 'Posted At', value: formatDatetime(j.postedAt) },
          { label: 'Total', value: formatCurrency(totalDebit) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card border border-default rounded-xl p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-base font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {j.reversedBy && (
        <div className="bg-warning-bg border border-warning rounded-xl p-4 mb-4 text-sm">
          This journal was reversed by <span className="font-mono">{j.reversedBy}</span>.
        </div>
      )}
      {j.isReversal && j.reversalOf && (
        <div className="bg-surface-raised border border-default rounded-xl p-4 mb-4 text-sm">
          This is a reversal of <span className="font-mono">{j.reversalOf}</span>.
        </div>
      )}

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3 text-sm">Lines</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Account</th>
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Debit</th>
                <th className="pb-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {j.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">
                    {l.accountCode} — {l.accountName}
                  </td>
                  <td className="py-2 text-secondary">{l.description ?? l.narration ?? '—'}</td>
                  <td className="py-2 text-right">
                    {parseFloat(l.debitAmount) > 0
                      ? formatCurrency(parseFloat(l.debitAmount))
                      : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {parseFloat(l.creditAmount) > 0
                      ? formatCurrency(parseFloat(l.creditAmount))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t border-default">
                <td className="py-2" colSpan={2}>
                  Total
                </td>
                <td className="py-2 text-right">{formatCurrency(totalDebit)}</td>
                <td className="py-2 text-right">{formatCurrency(totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => navigate('/accounting/journals')}>
          Back to Journals
        </Button>
      </div>

      <ERPConfirmModal
        open={showReverseConfirm}
        onClose={() => setShowReverseConfirm(false)}
        onConfirm={() => reverseMutation.mutate()}
        title="Reverse Journal"
        description="This will post an offsetting reversal journal (debits and credits swapped) and mark this journal as REVERSED. This action cannot be undone."
        confirmLabel="Reverse Journal"
        variant="danger"
        isLoading={reverseMutation.isPending}
      />
    </div>
  );
}
