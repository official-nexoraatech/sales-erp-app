import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { financialYearApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Checkbox from '../../components/ui/Checkbox.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import { formatDate } from '../../lib/format.js';

interface FinancialYear {
  id: number;
  yearCode: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
}

interface ChecklistItem {
  label: string;
  passed: boolean;
  detail?: string;
}

const STATUS_COLORS: Record<string, 'green' | 'red' | 'yellow' | 'gray'> = {
  OPEN: 'green',
  CLOSED: 'gray',
};

export default function FinancialYearsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canCloseYear = useAuthStore((s) => s.hasPermission(PERMISSIONS.FINANCIAL_YEAR_CLOSE));
  const canOpenYear = useAuthStore((s) => s.hasPermission(PERMISSIONS.FINANCIAL_YEAR_OPEN));
  const [, setSelectedFY] = useState<number | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [yearCode, setYearCode] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['financial-years'],
    queryFn: () => financialYearApi.list(),
  });

  const years: FinancialYear[] = (data as { content?: FinancialYear[] })?.content ?? [];

  const closeYearMutation = useMutation({
    mutationFn: (id: number) => financialYearApi.close(id),
    onSuccess: () => {
      toast.success('Financial year closed successfully');
      qc.invalidateQueries({ queryKey: ['financial-years'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Close failed';
      toast.error(msg);
    },
  });

  // The backend's POST /financial-years always existed, but this page never called it — with
  // no other route in the app that creates one either, every tenant had zero financial years
  // forever, with no way to open the first one. That silently breaks year-end closing AND the
  // Balance Sheet's "Current Year Earnings" computation (needs an open FY to find the period
  // start), which otherwise looks permanently unbalanced for any tenant with real P&L activity.
  const createYearMutation = useMutation({
    mutationFn: () => financialYearApi.create({ yearCode, startDate, endDate, isCurrent }),
    onSuccess: () => {
      toast.success('Financial year created');
      setShowCreateForm(false);
      setYearCode('');
      setStartDate('');
      setEndDate('');
      qc.invalidateQueries({ queryKey: ['financial-years'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create financial year';
      toast.error(msg);
    },
  });

  const runChecklist = async (id: number) => {
    setSelectedFY(id);
    setChecklist(null);
    try {
      const res = (await financialYearApi.getCloseChecklist(id)) as { items?: ChecklistItem[] };
      setChecklist(res.items ?? []);
    } catch {
      toast.error('Failed to run checklist');
    }
  };

  const columns: ERPColumnDef<FinancialYear>[] = [
    {
      key: 'yearCode',
      header: 'Year',
      render: (fy) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary">{fy.yearCode}</span>
          <Badge label={fy.status} color={STATUS_COLORS[fy.status] ?? 'gray'} />
          {fy.isCurrent && <Badge label="Current" color="blue" />}
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      render: (fy) => (
        <span className="text-xs text-secondary">
          {formatDate(fy.startDate)} — {formatDate(fy.endDate)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      hideable: false,
      render: (fy) =>
        canCloseYear && fy.status === 'OPEN' ? (
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => runChecklist(fy.id)}>
              Run Checklist
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={closeYearMutation.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Close Financial Year',
                  message: `Are you sure you want to close FY ${fy.yearCode}? This cannot be undone.`,
                  confirmLabel: 'Close Year',
                  variant: 'danger',
                });
                if (ok) closeYearMutation.mutate(fy.id);
              }}
            >
              Close Year
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Financial Years"
        subtitle="Manage fiscal periods and year-end close"
        actions={
          canOpenYear ? (
            <Button onClick={() => setShowCreateForm((v) => !v)}>
              {showCreateForm ? 'Cancel' : '+ New Financial Year'}
            </Button>
          ) : undefined
        }
      />

      {showCreateForm && (
        <div className="bg-surface-card rounded-xl border border-default p-6 space-y-4">
          <h3 className="font-semibold text-primary">New Financial Year</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label="Year Code"
              placeholder="FY2026-27"
              value={yearCode}
              onChange={(e) => setYearCode(e.target.value)}
              required
            />
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
          <Checkbox
            label="Set as current financial year"
            checked={isCurrent}
            onChange={(e) => setIsCurrent(e.target.checked)}
          />
          <Button
            disabled={!yearCode || !startDate || !endDate || createYearMutation.isPending}
            onClick={() => createYearMutation.mutate()}
          >
            {createYearMutation.isPending ? 'Creating…' : 'Create Financial Year'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ERPDataGrid
          columns={columns}
          data={years}
          isLoading={isLoading}
          rowKey="id"
          emptyState={
            <ERPEmptyState
              type="no-data"
              title="No financial years configured"
              description="Financial years are set up during initial company configuration."
              {...(canOpenYear
                ? {
                    action: {
                      label: '+ New Financial Year',
                      onClick: () => setShowCreateForm(true),
                    },
                  }
                : {})}
            />
          }
        />

        {checklist && (
          <div className="bg-surface-card rounded-xl border border-default p-4">
            <h3 className="font-semibold text-primary mb-3">Pre-Close Checklist</h3>
            <div className="space-y-2">
              {checklist.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg text-sm ${item.passed ? 'bg-success-bg' : 'bg-danger-bg'}`}
                >
                  <span className={item.passed ? 'text-success' : 'text-danger'}>
                    {item.passed ? '✓' : '✗'}
                  </span>
                  <div>
                    <div className={`font-medium ${item.passed ? 'text-success' : 'text-danger'}`}>
                      {item.label}
                    </div>
                    {item.detail && (
                      <div className="text-xs text-secondary mt-0.5">{item.detail}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div
              className={`mt-4 px-3 py-2 rounded-lg text-sm font-medium text-center ${checklist.every((i) => i.passed) ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}
            >
              {checklist.every((i) => i.passed)
                ? '✓ Ready for year-end close'
                : '✗ Some checks failed — resolve before closing'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
