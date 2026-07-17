import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { accountApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatCurrency } from '../../lib/format.js';

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
  balance?: number;
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
  const canEditAccount = useAuthStore((s) => s.hasPermission(PERMISSIONS.ACCOUNT_UPDATE));

  return (
    <>
      <tr className="border-b border-default hover:bg-surface-raised">
        <td className="px-4 py-2.5 font-mono text-xs text-disabled">{account.accountCode}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 16}px` }}>
            {hasChildren && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="mr-1.5 text-disabled hover:text-secondary text-xs w-4"
              >
                {expanded ? '▼' : '▶'}
              </button>
            )}
            {!hasChildren && <span className="mr-1.5 w-4" />}
            <span className={`text-sm ${depth === 0 ? 'font-semibold' : ''} text-primary`}>
              {account.name}
            </span>
            {account.isSystem && <span className="ml-2 text-xs text-disabled">(system)</span>}
            {account.isCash && <Badge label="Cash" color="green" />}
            {account.isBank && <Badge label="Bank" color="blue" />}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <Badge label={account.accountType} color={TYPE_COLORS[account.accountType] ?? 'gray'} />
        </td>
        <td className="px-4 py-2.5 text-xs text-secondary">{account.normalBalance}</td>
        <td className="px-4 py-2.5 text-right text-sm text-secondary">
          {account.balance !== undefined ? formatCurrency(account.balance) : '–'}
        </td>
        <td className="px-4 py-2.5">
          {canEditAccount && !account.isSystem && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/accounting/accounts/${account.id}/edit`)}
            >
              Edit
            </Button>
          )}
        </td>
      </tr>
      {expanded &&
        hasChildren &&
        account.children!.map((child) => (
          <AccountRow key={child.id} account={child} depth={depth + 1} />
        ))}
    </>
  );
}

export default function ChartOfAccountsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreateAccount = useAuthStore((s) => s.hasPermission(PERMISSIONS.ACCOUNT_CREATE));
  const { data, isLoading } = useQuery({
    queryKey: ['accounts-tree'],
    queryFn: () => accountApi.tree(),
  });
  const tree = (data as Account[]) ?? [];

  const seedMutation = useMutation({
    mutationFn: () => accountApi.seed(),
    onSuccess: () => {
      toast.success('Default accounts seeded');
      qc.invalidateQueries({ queryKey: ['accounts-tree'] });
    },
    onError: () => toast.error('Seed failed'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Chart of Accounts"
        subtitle="Manage your accounting structure."
        actions={
          canCreateAccount ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => seedMutation.mutate()}
                loading={seedMutation.isPending}
              >
                Seed Default CoA
              </Button>
              <Button onClick={() => navigate('/accounting/accounts/new')}>+ New Account</Button>
            </div>
          ) : undefined
        }
      />

      <div className="rounded-xl border border-default overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={6} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle border-b border-default">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide text-left w-28">
                    Code
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide text-left">
                    Account Name
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide text-left">
                    Type
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide text-left">
                    Balance
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold text-secondary uppercase tracking-wide text-right">
                    Opening Bal.
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tree.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <ERPEmptyState
                        type="no-data"
                        title="No accounts yet"
                        description='Click "Seed Default CoA" to get started.'
                        {...(canCreateAccount
                          ? {
                              action: {
                                label: 'Seed Default CoA',
                                onClick: () => seedMutation.mutate(),
                              },
                            }
                          : {})}
                      />
                    </td>
                  </tr>
                ) : (
                  tree.map((account) => <AccountRow key={account.id} account={account} />)
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
