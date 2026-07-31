import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi, userApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';

interface Quota {
  id: number;
  subjectType: 'REP' | 'TERRITORY';
  subjectUserId: number | null;
  subjectTerritoryId: number | null;
  subjectName: string;
  periodYear: number;
  periodMonth: number;
  quotaAmount?: number;
  version: number;
}

interface Territory {
  id: number;
  name: string;
}

interface StaffUser {
  id: number;
  firstName: string;
  lastName: string;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function currentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function EditQuotaRow({ quota }: { quota: Quota }): React.ReactElement {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(quota.quotaAmount ?? ''));

  const updateMut = useMutation({
    mutationFn: () =>
      crmApi.updateQuota(quota.id, { quotaAmount: parseFloat(amount), version: quota.version }),
    onSuccess: () => {
      toast.success('Quota updated');
      void queryClient.invalidateQueries({ queryKey: ['crm-quotas'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-quota-attainment'] });
    },
    onError: () => toast.error('Could not update quota — it may have changed since you loaded it'),
  });

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-32 rounded-md border border-default bg-surface-page px-2 py-1 text-sm"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={updateMut.isPending || amount === String(quota.quotaAmount ?? '')}
        onClick={() => updateMut.mutate()}
      >
        Save
      </Button>
    </div>
  );
}

export default function QuotasPage(): React.ReactElement {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.QUOTA_MANAGE);
  const queryClient = useQueryClient();

  const [{ year, month }, setPeriod] = useState(currentPeriod());
  const [showForm, setShowForm] = useState(false);
  const [subjectType, setSubjectType] = useState<'REP' | 'TERRITORY'>('REP');
  const [subjectId, setSubjectId] = useState<number | ''>('');
  const [quotaAmount, setQuotaAmount] = useState('');

  const { data: quotaData, isLoading } = useQuery({
    queryKey: ['crm-quotas', year, month],
    queryFn: () => crmApi.listQuotas({ periodYear: year, periodMonth: month }),
  });
  const quotas = ((quotaData as { content?: Quota[] })?.content ?? []) as Quota[];

  const { data: territoryData } = useQuery({
    queryKey: ['crm-territories'],
    queryFn: () => crmApi.listTerritories(),
  });
  const territories = ((territoryData as { content?: Territory[] })?.content ?? []) as Territory[];

  const { data: userData } = useQuery({
    queryKey: ['users-for-quota'],
    queryFn: () => userApi.list(),
  });
  const staffUsers = ((userData as { content?: StaffUser[] })?.content ?? []) as StaffUser[];

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createQuota({
        subjectType,
        ...(subjectType === 'REP'
          ? { subjectUserId: subjectId }
          : { subjectTerritoryId: subjectId }),
        periodYear: year,
        periodMonth: month,
        quotaAmount: parseFloat(quotaAmount),
      }),
    onSuccess: () => {
      toast.success('Quota created');
      setSubjectId('');
      setQuotaAmount('');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['crm-quotas'] });
      void queryClient.invalidateQueries({ queryKey: ['crm-quota-attainment'] });
    },
    onError: () =>
      toast.error('Could not create quota — a quota for this subject and period may already exist'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Sales Quotas"
        subtitle="Set monthly targets per rep or territory and track attainment"
        actions={
          canManage ? (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ New Quota'}
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-2 text-sm">
        <label className="text-secondary">Period:</label>
        <select
          value={month}
          onChange={(e) => setPeriod({ year, month: parseInt(e.target.value, 10) })}
          className="rounded-md border border-default bg-surface-page px-2 py-1"
        >
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => setPeriod({ year: parseInt(e.target.value, 10), month })}
          className="w-24 rounded-md border border-default bg-surface-page px-2 py-1"
        />
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (subjectId !== '') createMut.mutate();
          }}
          className="mb-6 space-y-3 rounded-xl border border-default bg-surface-card p-4"
        >
          <div className="flex gap-4">
            <label className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                checked={subjectType === 'REP'}
                onChange={() => {
                  setSubjectType('REP');
                  setSubjectId('');
                }}
              />
              Rep
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                checked={subjectType === 'TERRITORY'}
                onChange={() => {
                  setSubjectType('TERRITORY');
                  setSubjectId('');
                }}
              />
              Territory
            </label>
          </div>
          <div>
            <label className="text-xs text-secondary">
              {subjectType === 'REP' ? 'Rep' : 'Territory'}
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value ? parseInt(e.target.value, 10) : '')}
              required
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {subjectType === 'REP'
                ? staffUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </option>
                  ))
                : territories.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-secondary">Quota Amount</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={quotaAmount}
              onChange={(e) => setQuotaAmount(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
            />
          </div>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Quota'}
          </Button>
        </form>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">
            Quotas for {MONTH_NAMES[month - 1]} {year}
          </h2>
        </div>
        {isLoading ? (
          <div className="p-4">
            <ERPCardSkeleton lines={2} />
          </div>
        ) : quotas.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No quotas set for this period"
            description="Set a rep or territory quota to start tracking attainment."
            {...(canManage
              ? { action: { label: '+ New Quota', onClick: () => setShowForm(true) } }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {quotas.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between px-5 py-3 flex-wrap gap-2"
              >
                <div>
                  <p className="text-sm font-medium text-primary">{q.subjectName}</p>
                  <p className="text-xs text-secondary">{q.subjectType}</p>
                </div>
                {q.quotaAmount !== undefined && canManage ? (
                  <EditQuotaRow quota={q} />
                ) : q.quotaAmount !== undefined ? (
                  <span className="text-sm text-primary">₹{q.quotaAmount}</span>
                ) : (
                  <span className="text-xs text-secondary">Hidden</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
