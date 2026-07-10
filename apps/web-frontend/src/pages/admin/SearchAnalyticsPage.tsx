import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RotateCcw, Trash2, Search as SearchIcon } from 'lucide-react';
import { searchAnalyticsApi, searchDeadLettersApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';

function StatCard({ label, value, color = 'text-primary' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-surface-card rounded-xl border border-default p-4">
      <p className="text-xs text-secondary uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

export default function SearchAnalyticsPage() {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['search-analytics-summary', days],
    queryFn: () => searchAnalyticsApi.summary(days),
  });

  const { data: deadLetters, isLoading: dlqLoading } = useQuery({
    queryKey: ['search-dead-letters'],
    queryFn: () => searchDeadLettersApi.list('PENDING'),
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => searchDeadLettersApi.retry(id),
    onSuccess: () => {
      toast.success('Retry succeeded — document re-indexed');
      void queryClient.invalidateQueries({ queryKey: ['search-dead-letters'] });
    },
    onError: () => toast.error('Retry failed — Elasticsearch may still be unavailable'),
  });

  const discardMutation = useMutation({
    mutationFn: (id: number) => searchDeadLettersApi.discard(id),
    onSuccess: () => {
      toast.success('Discarded');
      void queryClient.invalidateQueries({ queryKey: ['search-dead-letters'] });
    },
  });

  const clickThroughRate = summary && summary.totalSearches > 0
    ? `${Math.round((summary.clickedCount / summary.totalSearches) * 100)}%`
    : '—';

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Search Analytics & Health"
        subtitle="Global search usage, popular/failed queries, and index sync health"
        icon={SearchIcon}
        actions={
          <select
            aria-label="Time range"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-default bg-surface-card text-sm text-primary"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        }
      />

      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Searches" value={summary.totalSearches} />
          <StatCard label="No-Result Searches" value={summary.noResultCount} color={summary.noResultCount > 0 ? 'text-warning' : 'text-primary'} />
          <StatCard label="Avg Latency" value={`${summary.avgLatencyMs}ms`} color={summary.avgLatencyMs > 300 ? 'text-warning' : 'text-success'} />
          <StatCard label="Click-Through Rate" value={clickThroughRate} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="bg-surface-card rounded-xl border border-default p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">Popular Searches</h2>
          {summary && summary.popularQueries.length > 0 ? (
            <ul className="space-y-1.5">
              {summary.popularQueries.map((q) => (
                <li key={q.query} className="flex items-center justify-between text-sm">
                  <span className="text-primary truncate">{q.query}</span>
                  <span className="text-secondary shrink-0 ml-2">{q.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">No searches recorded in this period.</p>
          )}
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-4">
          <h2 className="text-sm font-semibold text-primary mb-3">No-Result Searches</h2>
          {summary && summary.noResultQueries.length > 0 ? (
            <ul className="space-y-1.5">
              {summary.noResultQueries.map((q) => (
                <li key={q.query} className="flex items-center justify-between text-sm">
                  <span className="text-primary truncate">{q.query}</span>
                  <span className="text-warning shrink-0 ml-2">{q.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-secondary">No searches came up empty — nice.</p>
          )}
        </div>
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-4">
        <h2 className="text-sm font-semibold text-primary mb-3">Index Sync Failures (Dead Letter Queue)</h2>
        {dlqLoading ? (
          <p className="text-sm text-secondary">Loading…</p>
        ) : !deadLetters || deadLetters.content.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No pending sync failures"
            description="Every recent create/update/delete has been indexed into Elasticsearch successfully."
          />
        ) : (
          <ul className="divide-y divide-default">
            {deadLetters.content.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-primary truncate">{item.topic}</p>
                  <p className="text-xs text-danger truncate">{item.errorMessage}</p>
                  <p className="text-xs text-secondary">Retried {item.retryCount}x · {new Date(item.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Button size="sm" variant="outline" onClick={() => retryMutation.mutate(item.id)} disabled={retryMutation.isPending}>
                    <RotateCcw size={14} />
                    Retry
                  </Button>
                  <Button size="sm" variant="danger-outline" onClick={() => discardMutation.mutate(item.id)} disabled={discardMutation.isPending}>
                    <Trash2 size={14} />
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
