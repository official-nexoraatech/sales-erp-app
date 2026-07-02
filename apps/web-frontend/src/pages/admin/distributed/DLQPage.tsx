import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { dlqApi } from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import Button from '../../../components/ui/Button.js';
import Badge from '../../../components/ui/Badge.js';
import { formatDate } from '../../../lib/format.js';

interface DLQSummaryRow {
  topic: string;
  pending: number;
  replayed: number;
  discarded: number;
  total: number;
}

interface DLQItem {
  id: number;
  topic: string;
  partition: number;
  offset: string;
  errorMessage: string;
  retryCount: number;
  status: string;
  createdAt: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
}

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  PENDING: 'warning',
  REPLAYED: 'success',
  DISCARDED: 'danger',
};

export default function DLQPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<DLQItem | null>(null);

  const { data: summaryData } = useQuery({
    queryKey: ['dlq-summary'],
    queryFn: () => dlqApi.summary(),
    refetchInterval: 30_000,
  });
  const summary: DLQSummaryRow[] = (summaryData as unknown as DLQSummaryRow[]) ?? [];

  const totalPending = summary.reduce((acc, s) => acc + s.pending, 0);
  const totalReplayed = summary.reduce((acc, s) => acc + s.replayed, 0);
  const totalDiscarded = summary.reduce((acc, s) => acc + s.discarded, 0);

  const { data: listData } = useQuery({
    queryKey: ['dlq-list', selectedTopic],
    queryFn: () => dlqApi.list(selectedTopic!),
    enabled: !!selectedTopic,
  });
  const items: DLQItem[] = ((listData as Record<string, unknown>)?.content as DLQItem[]) ?? [];

  const replayMutation = useMutation({
    mutationFn: (topic: string) => dlqApi.replay(topic),
    onSuccess: () => {
      toast.success('All PENDING items queued for replay');
      void qc.invalidateQueries({ queryKey: ['dlq-summary'] });
      void qc.invalidateQueries({ queryKey: ['dlq-list'] });
    },
    onError: () => toast.error('Replay failed'),
  });

  const discardMutation = useMutation({
    mutationFn: (id: number) => dlqApi.discard(id),
    onSuccess: () => {
      toast.success('Item discarded');
      setSelectedItem(null);
      void qc.invalidateQueries({ queryKey: ['dlq-list'] });
    },
    onError: () => toast.error('Discard failed'),
  });

  const topicPending = selectedTopic
    ? (summary.find((s) => s.topic === selectedTopic)?.pending ?? 0)
    : 0;

  return (
    <div className="space-y-6">
      <ERPPageHeader variant="list" title="Dead Letter Queue" subtitle="Inspect and replay failed Kafka messages" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">PENDING</p>
          <p className="text-2xl font-bold text-warning">{totalPending}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">REPLAYED</p>
          <p className="text-2xl font-bold text-success">{totalReplayed}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">DISCARDED</p>
          <p className="text-2xl font-bold text-danger">{totalDiscarded}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">TOTAL TOPICS</p>
          <p className="text-2xl font-bold text-primary">{summary.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Topic list */}
        <div className="card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-primary mb-3">Topics</h3>
          {summary.length === 0 ? (
            <p className="text-sm text-secondary">No DLQ topics found</p>
          ) : (
            summary.map((row) => (
              <button
                key={row.topic}
                onClick={() => setSelectedTopic(row.topic)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedTopic === row.topic ? 'bg-primary text-white' : 'hover:bg-surface-hover text-primary'
                }`}
              >
                <span className="block font-medium truncate">{row.topic}</span>
                {row.pending > 0 && <span className="text-xs opacity-75">{row.pending} pending</span>}
              </button>
            ))
          )}
        </div>

        {/* Items list */}
        <div className="card p-4 lg:col-span-2">
          {!selectedTopic ? (
            <p className="text-sm text-secondary">Select a topic to view items</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-primary">{selectedTopic}</h3>
                {hasPermission(PERMISSIONS.DLQ_MANAGE) && topicPending > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={replayMutation.isPending}
                    onClick={() => replayMutation.mutate(selectedTopic)}
                  >
                    Replay All Pending
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    className="w-full text-left px-3 py-3 rounded-lg border border-border hover:bg-surface-hover transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-mono text-secondary">offset: {item.offset}</span>
                      <Badge variant={STATUS_VARIANT[item.status] ?? 'default'}>{item.status}</Badge>
                    </div>
                    <p className="text-sm text-primary truncate">{item.errorMessage}</p>
                    <div className="flex items-center gap-4 mt-1 text-xs text-secondary">
                      <span>Retries: {item.retryCount}</span>
                      <span>{formatDate(item.createdAt)}</span>
                    </div>
                  </button>
                ))}
                {items.length === 0 && (
                  <p className="text-sm text-secondary text-center py-8">No items in this topic</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Item detail modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedItem(null)}>
          <div className="bg-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-primary">DLQ Item #{selectedItem.id}</h3>
              <Badge variant={STATUS_VARIANT[selectedItem.status] ?? 'default'}>{selectedItem.status}</Badge>
            </div>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-secondary">Topic</dt><dd className="font-mono text-primary">{selectedItem.topic}</dd></div>
              <div><dt className="text-secondary">Offset</dt><dd className="font-mono text-primary">{selectedItem.offset}</dd></div>
              <div><dt className="text-secondary">Error</dt><dd className="text-danger">{selectedItem.errorMessage}</dd></div>
              <div><dt className="text-secondary">Retry Count</dt><dd className="text-primary">{selectedItem.retryCount}</dd></div>
              <div><dt className="text-secondary">Created</dt><dd className="text-primary">{formatDate(selectedItem.createdAt)}</dd></div>
              <div>
                <dt className="text-secondary mb-1">Payload</dt>
                <dd><pre className="bg-surface-hover rounded p-3 text-xs overflow-x-auto">{JSON.stringify(selectedItem.payload, null, 2)}</pre></dd>
              </div>
            </dl>
            {hasPermission(PERMISSIONS.DLQ_MANAGE) && selectedItem.status === 'PENDING' && (
              <div className="flex gap-2 mt-4">
                <Button variant="danger" size="sm" loading={discardMutation.isPending} onClick={() => discardMutation.mutate(selectedItem.id)}>
                  Discard
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setSelectedItem(null)}>Close</Button>
              </div>
            )}
            {(selectedItem.status !== 'PENDING' || !hasPermission(PERMISSIONS.DLQ_MANAGE)) && (
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setSelectedItem(null)}>Close</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
