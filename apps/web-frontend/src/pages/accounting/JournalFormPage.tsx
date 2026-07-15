import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { journalApi, accountApi, costCenterApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import { formatCurrency } from '../../lib/format.js';
import type { ApiError } from '../../api/client.js';

interface Account {
  id: number;
  accountCode: string;
  name: string;
}

interface CostCenter {
  id: number;
  code: string;
  name: string;
}

interface JournalLine {
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
  costCenterId: string;
}

function emptyLine(): JournalLine {
  return { accountId: '', debitAmount: '', creditAmount: '', description: '', costCenterId: '' };
}

export default function JournalFormPage() {
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(), emptyLine()]);

  const { data: accountData } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => accountApi.list(),
  });
  const { data: costCenterData } = useQuery({
    queryKey: ['cost-centers-list'],
    queryFn: () => costCenterApi.list(),
  });

  const accounts = (accountData as { content?: Account[] })?.content ?? [];
  const costCenters = costCenterData as CostCenter[] | { content?: CostCenter[] } | undefined;
  const costCenterList = Array.isArray(costCenters) ? costCenters : (costCenters?.content ?? []);

  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debitAmount) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.creditAmount) || 0), 0);
  const isBalanced =
    lines.length >= 2 && totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  const updateLine = (idx: number, field: keyof JournalLine, value: string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => journalApi.create(data),
    onSuccess: (data: unknown) => {
      const result = data as { journalId?: string };
      toast.success('Journal posted');
      navigate(`/accounting/journals/${result?.journalId}`);
    },
    onError: (e: ApiError) => toast.error(e.message || 'Failed to post journal'),
  });

  const handleSubmit = (): void => {
    if (!description.trim()) {
      toast.error('Description is required');
      return;
    }
    const validLines = lines.filter(
      (l) => l.accountId && (parseFloat(l.debitAmount) > 0 || parseFloat(l.creditAmount) > 0)
    );
    if (validLines.length < 2) {
      toast.error('A journal requires at least 2 lines, each with an account and an amount');
      return;
    }
    if (!isBalanced) {
      toast.error(
        `Journal is unbalanced: debit ${formatCurrency(totalDebit)} vs credit ${formatCurrency(totalCredit)}`
      );
      return;
    }

    createMutation.mutate({
      description: description.trim(),
      lines: validLines.map((l) => ({
        accountId: Number(l.accountId),
        debitAmount: parseFloat(l.debitAmount) || 0,
        creditAmount: parseFloat(l.creditAmount) || 0,
        description: l.description || undefined,
        costCenterId: l.costCenterId ? Number(l.costCenterId) : undefined,
      })),
    });
  };

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Manual Journal"
        subtitle="Post a balanced double-entry journal"
        backTo="/accounting/journals"
      />

      <div className="mb-6">
        <ERPTextarea
          label="Description"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What is this journal entry for?"
        />
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-default">
                <th className="pb-2">Account</th>
                <th className="pb-2">Debit</th>
                <th className="pb-2">Credit</th>
                <th className="pb-2">Line Description</th>
                <th className="pb-2">Cost Center</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="py-2 pr-2">
                    <select
                      value={l.accountId}
                      onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                      className="w-52 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    >
                      <option value="">Select account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountCode} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.debitAmount}
                      onChange={(e) => updateLine(idx, 'debitAmount', e.target.value)}
                      className="w-28 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.creditAmount}
                      onChange={(e) => updateLine(idx, 'creditAmount', e.target.value)}
                      className="w-28 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={l.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      className="w-40 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={l.costCenterId}
                      onChange={(e) => updateLine(idx, 'costCenterId', e.target.value)}
                      className="w-36 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    >
                      <option value="">—</option>
                      {costCenterList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    {lines.length > 2 && (
                      <button
                        onClick={() => removeLine(idx)}
                        className="text-danger hover:text-danger text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button variant="ghost" className="mt-3" onClick={addLine}>
          + Add Line
        </Button>

        <div className="mt-4 pt-4 border-t border-default flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-secondary">Total Debit</span>
              <span>{formatCurrency(totalDebit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">Total Credit</span>
              <span>{formatCurrency(totalCredit)}</span>
            </div>
            <div
              className={`flex justify-between font-bold text-base pt-1 border-t border-default ${isBalanced ? 'text-success' : 'text-danger'}`}
            >
              <span>{isBalanced ? 'Balanced' : 'Unbalanced'}</span>
              <span>{formatCurrency(Math.abs(totalDebit - totalCredit))}</span>
            </div>
          </div>
        </div>
      </div>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate('/accounting/journals')}>
          Cancel
        </Button>
        <Button isLoading={createMutation.isPending} disabled={!isBalanced} onClick={handleSubmit}>
          Post Journal
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
