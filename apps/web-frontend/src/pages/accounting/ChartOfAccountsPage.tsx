import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { accountApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Account {
  id: number;
  accountCode: string;
  name: string;
  accountType: string;
  accountSubType?: string;
  normalBalance: string;
  isSystem: boolean;
  isCash: boolean;
  isBank: boolean;
  children?: Account[];
  openingBalance?: string;
}

const TYPE_COLORS: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'indigo' | 'gray'> = {
  ASSET: 'blue',
  LIABILITY: 'red',
  EQUITY: 'indigo',
  INCOME: 'green',
  EXPENSE: 'yellow',
  CONTRA: 'gray',
};

function AccountRow({ account, depth = 0 }: { account: Account; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = (account.children?.length ?? 0) > 0;
  const navigate = useNavigate();

  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
        <td className="px-4 py-2.5 font-mono text-xs text-gray-400">{account.accountCode}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 16}px` }}>
            {hasChildren && (
              <button onClick={() => setExpanded((e) => !e)} className="mr-1.5 text-gray-400 hover:text-gray-600 text-xs w-4">
                {expanded ? '▼' : '▶'}
              </button>
            )}
            {!hasChildren && <span className="mr-1.5 w-4" />}
            <span className={`text-sm ${depth === 0 ? 'font-semibold' : ''} text-gray-800 dark:text-gray-200`}>
              {account.name}
            </span>
            {account.isSystem && <span className="ml-2 text-xs text-gray-400">(system)</span>}
            {account.isCash && <Badge label="Cash" color="green" />}
            {account.isBank && <Badge label="Bank" color="blue" />}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <Badge label={account.accountType} color={TYPE_COLORS[account.accountType] ?? 'gray'} />
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500">{account.normalBalance}</td>
        <td className="px-4 py-2.5 text-right text-sm text-gray-700 dark:text-gray-300">
          {account.openingBalance ? formatCurrency(parseFloat(account.openingBalance)) : '–'}
        </td>
        <td className="px-4 py-2.5">
          {!account.isSystem && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/accounting/accounts/${account.id}/edit`)}>Edit</Button>
          )}
        </td>
      </tr>
      {expanded && hasChildren && account.children!.map((child) => (
        <AccountRow key={child.id} account={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function ChartOfAccountsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['accounts-tree'], queryFn: () => accountApi.tree() });
  const tree = ((data as Record<string, unknown>)?.data as Account[]) ?? [];

  const seedMutation = useMutation({
    mutationFn: () => fetch('http://localhost:3019/accounts/seed', { method: 'POST' }).then((r) => r.json()),
    onSuccess: () => { toast.success('Default accounts seeded'); qc.invalidateQueries({ queryKey: ['accounts-tree'] }); },
    onError: () => toast.error('Seed failed'),
  });

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Chart of Accounts"
        subtitle="Manage your accounting structure."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => seedMutation.mutate()} loading={seedMutation.isPending}>
              Seed Default CoA
            </Button>
            <Button onClick={() => navigate('/accounting/accounts/new')}>+ New Account</Button>
          </div>
        }
      />

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left w-28">Code</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Account Name</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Type</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">Balance</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Opening Bal.</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : tree.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No accounts. Click "Seed Default CoA" to get started.</td></tr>
            ) : (
              tree.map((account) => <AccountRow key={account.id} account={account} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
