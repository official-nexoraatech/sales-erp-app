import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { sagaAdminApi } from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import Button from '../../../components/ui/Button.js';
import Badge from '../../../components/ui/Badge.js';
import Select from '../../../components/ui/Select.js';
import { formatDate } from '../../../lib/format.js';

interface SagaSummary {
  statusCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  stalledCount: number;
  completedLast24h: number;
  avgDurationMs: number;
}

interface SagaItem {
  id: string;
  sagaType: string;
  correlationId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  stepHistory: Array<{ step: string; status: string; occurredAt: string; error?: string }>;
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  STARTED: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  COMPENSATING: 'warning',
  COMPENSATED: 'default',
};

const STATUSES = ['', 'STARTED', 'COMPLETED', 'FAILED', 'COMPENSATING', 'COMPENSATED'];

export default function SagaMonitorPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedSaga, setSelectedSaga] = useState<SagaItem | null>(null);

  const { data: summaryData } = useQuery<SagaSummary>({
    queryKey: ['saga-summary'],
    queryFn: () => sagaAdminApi.summary() as Promise<SagaSummary>,
    refetchInterval: 15_000,
  });
  const summary = summaryData as unknown as SagaSummary | undefined;

  const { data: listData } = useQuery({
    queryKey: ['saga-list', statusFilter],
    queryFn: () => {
      const params: Parameters<typeof sagaAdminApi.list>[0] = {};
      if (statusFilter) params.status = statusFilter;
      return sagaAdminApi.list(params);
    },
    refetchInterval: 15_000,
  });
  const sagas: SagaItem[] = ((listData as Record<string, unknown>)?.content as SagaItem[]) ?? [];

  const retryMutation = useMutation({
    mutationFn: (id: string) => sagaAdminApi.retry(id),
    onSuccess: () => {
      toast.success('Saga retried');
      void qc.invalidateQueries({ queryKey: ['saga-list'] });
      void qc.invalidateQueries({ queryKey: ['saga-summary'] });
      setSelectedSaga(null);
    },
    onError: () => toast.error('Retry failed'),
  });

  const compensateMutation = useMutation({
    mutationFn: (id: string) => sagaAdminApi.compensate(id),
    onSuccess: () => {
      toast.success('Saga compensation started');
      void qc.invalidateQueries({ queryKey: ['saga-list'] });
      setSelectedSaga(null);
    },
    onError: () => toast.error('Compensate failed'),
  });

  return (
    <div className="space-y-6">
      <ERPPageHeader variant="list" title="Saga Monitor" subtitle="Track distributed transaction orchestration" />

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="card p-4">
            <p className="text-xs text-secondary mb-1">COMPLETED (24h)</p>
            <p className="text-2xl font-bold text-success">{summary.completedLast24h}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-secondary mb-1">FAILED</p>
            <p className="text-2xl font-bold text-danger">{summary.statusCounts?.['FAILED'] ?? 0}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-secondary mb-1">STALLED (&gt;30min)</p>
            <p className="text-2xl font-bold text-warning">{summary.stalledCount}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-secondary mb-1">IN PROGRESS</p>
            <p className="text-2xl font-bold text-info">{summary.statusCounts?.['STARTED'] ?? 0}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-secondary mb-1">AVG DURATION</p>
            <p className="text-2xl font-bold text-primary">
              {summary.avgDurationMs ? `${(summary.avgDurationMs / 1000).toFixed(1)}s` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="card p-4 flex items-center gap-4">
        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={STATUSES.map((s) => ({ value: s, label: s || 'All Statuses' }))}
        />
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-hover">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Saga ID</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Created</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">Updated</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sagas.map((saga) => (
              <tr key={saga.id} className="hover:bg-surface-hover">
                <td className="px-4 py-3 font-mono text-xs text-secondary">{saga.id.substring(0, 12)}…</td>
                <td className="px-4 py-3 text-primary font-medium">{saga.sagaType}</td>
                <td className="px-4 py-3"><Badge variant={STATUS_VARIANT[saga.status] ?? 'default'}>{saga.status}</Badge></td>
                <td className="px-4 py-3 text-secondary">{formatDate(saga.createdAt)}</td>
                <td className="px-4 py-3 text-secondary">{formatDate(saga.updatedAt)}</td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="ghost" onClick={() => setSelectedSaga(saga)}>View</Button>
                </td>
              </tr>
            ))}
            {sagas.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-secondary">No sagas found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Saga detail modal */}
      {selectedSaga && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedSaga(null)}>
          <div className="bg-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-primary">{selectedSaga.sagaType}</h3>
              <Badge variant={STATUS_VARIANT[selectedSaga.status] ?? 'default'}>{selectedSaga.status}</Badge>
            </div>
            <dl className="space-y-2 text-sm mb-4">
              <div><dt className="text-secondary">Saga ID</dt><dd className="font-mono text-primary text-xs">{selectedSaga.id}</dd></div>
              <div><dt className="text-secondary">Correlation ID</dt><dd className="font-mono text-primary text-xs">{selectedSaga.correlationId}</dd></div>
              <div><dt className="text-secondary">Created</dt><dd className="text-primary">{formatDate(selectedSaga.createdAt)}</dd></div>
            </dl>
            <h4 className="text-sm font-semibold text-primary mb-2">Step History</h4>
            <div className="space-y-2">
              {(selectedSaga.stepHistory ?? []).map((step, i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-surface-hover">
                  <Badge variant={step.status === 'SUCCESS' ? 'success' : step.status === 'FAILED' ? 'danger' : 'default'}>
                    {step.status}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium text-primary">{step.step}</p>
                    {step.error && <p className="text-xs text-danger">{step.error}</p>}
                    <p className="text-xs text-secondary">{formatDate(step.occurredAt)}</p>
                  </div>
                </div>
              ))}
            </div>
            {hasPermission(PERMISSIONS.SAGA_MANAGE) && (
              <div className="flex gap-2 mt-4">
                {['FAILED', 'COMPENSATING'].includes(selectedSaga.status) && (
                  <Button variant="primary" size="sm" loading={retryMutation.isPending} onClick={() => retryMutation.mutate(selectedSaga.id)}>
                    Retry
                  </Button>
                )}
                {selectedSaga.status === 'STARTED' && (
                  <Button variant="danger" size="sm" loading={compensateMutation.isPending} onClick={() => compensateMutation.mutate(selectedSaga.id)}>
                    Compensate
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setSelectedSaga(null)}>Close</Button>
              </div>
            )}
            {!hasPermission(PERMISSIONS.SAGA_MANAGE) && (
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setSelectedSaga(null)}>Close</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
