import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { dayEndApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

// Multi-vertical platform audit 2026-08-16, Phase 3 — store-wide Z-report/day-end settlement,
// one level up from a single till's Close Shift (which only reconciles that one till's cash).
interface Branch {
  id: number;
  name: string;
}

interface DayEndSettlement {
  id: number;
  branchId: number;
  businessDate: string;
  sessionCount: number;
  totalTransactions: number;
  totalSales: string;
  totalDiscount: string;
  totalTax: string;
  totalRefunds: string;
  refundCount: number;
  paymentModeBreakdown: Record<string, string>;
  openingCashTotal: string;
  closingCashTotal: string;
  expectedCashTotal: string;
  cashVarianceTotal: string;
  generatedAt: string;
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DayEndSettlementPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canGenerate = hasPermission(PERMISSIONS.POS_ZREPORT_GENERATE);
  const qc = useQueryClient();

  const [branchId, setBranchId] = useState('');
  const [businessDate, setBusinessDate] = useState(todayISODate());
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
  });
  const branches: Branch[] = (branchData as { content?: Branch[] })?.content ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['pos-day-end-settlements'],
    queryFn: () => dayEndApi.list({ page: 1, pageSize: 50 }),
  });
  const settlements: DayEndSettlement[] = (data as { content?: DayEndSettlement[] })?.content ?? [];

  const generateMutation = useMutation({
    mutationFn: () => dayEndApi.generate({ branchId: Number(branchId), businessDate }),
    onSuccess: () => {
      toast.success(`Z-report generated for ${businessDate}`);
      void qc.invalidateQueries({ queryKey: ['pos-day-end-settlements'] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to generate day-end settlement');
    },
  });

  function branchName(id: number): string {
    return branches.find((b) => b.id === id)?.name ?? `Branch #${id}`;
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Day-End Settlement"
        subtitle="Store-wide Z-report — consolidates every till's sales, payment modes, and cash reconciliation for a business day"
      />

      {canGenerate && (
        <div className="bg-surface-card rounded-xl border border-default p-5 mb-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              generateMutation.mutate();
            }}
          >
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">Branch</label>
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                required
                className="rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 min-w-[180px]"
              >
                <option value="" disabled>
                  Select branch…
                </option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Business Date
              </label>
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                required
                className="rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              />
            </div>
            <Button type="submit" disabled={generateMutation.isPending || !branchId}>
              Generate Z-Report
            </Button>
          </form>
          <p className="text-xs text-secondary mt-3">
            Every till opened on the selected date must be closed first. A day's Z-report can only
            be generated once — this is a final reading, not a re-runnable report.
          </p>
        </div>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={4} cols={4} />
        ) : settlements.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No day-end settlements generated yet"
            description="Once every till for a business day is closed, generate a store-wide Z-report above."
          />
        ) : (
          <div className="divide-y divide-default">
            {settlements.map((s) => {
              const expanded = expandedId === s.id;
              const varianceValue = parseFloat(s.cashVarianceTotal);
              return (
                <div key={s.id} className="px-5 py-4">
                  <button
                    type="button"
                    className="w-full flex items-start justify-between gap-4 text-left"
                    onClick={() => setExpandedId(expanded ? null : s.id)}
                    aria-expanded={expanded}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-primary">
                          {formatDate(s.businessDate)} · {branchName(s.branchId)}
                        </p>
                        {varianceValue !== 0 && (
                          <Badge
                            label={`Variance ${varianceValue > 0 ? '+' : ''}${formatCurrency(varianceValue)}`}
                            color={varianceValue > 0 ? 'blue' : 'red'}
                          />
                        )}
                      </div>
                      <p className="text-xs text-secondary mt-0.5">
                        {s.sessionCount} session{s.sessionCount === 1 ? '' : 's'} ·{' '}
                        {s.totalTransactions} transaction{s.totalTransactions === 1 ? '' : 's'} ·
                        Sales {formatCurrency(parseFloat(s.totalSales))}
                      </p>
                    </div>
                  </button>

                  {expanded && (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-secondary">Total Sales</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.totalSales))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Discounts</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.totalDiscount))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Tax Collected</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.totalTax))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Refunds ({s.refundCount})</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.totalRefunds))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Opening Cash</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.openingCashTotal))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Closing Cash</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.closingCashTotal))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Expected Cash</p>
                        <p className="font-semibold text-primary">
                          {formatCurrency(parseFloat(s.expectedCashTotal))}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-secondary">Cash Variance</p>
                        <p
                          className={`font-semibold ${varianceValue === 0 ? 'text-primary' : varianceValue > 0 ? 'text-info' : 'text-danger'}`}
                        >
                          {formatCurrency(varianceValue)}
                        </p>
                      </div>
                      <div className="col-span-2 sm:col-span-4">
                        <p className="text-xs text-secondary mb-1.5">
                          Payment Mode Breakdown (cash collected, not net of refunds)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(s.paymentModeBreakdown).map(([mode, amount]) => (
                            <Badge
                              key={mode}
                              label={`${mode}: ${formatCurrency(parseFloat(amount))}`}
                              color="gray"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
