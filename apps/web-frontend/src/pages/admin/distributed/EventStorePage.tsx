import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { eventStoreApi } from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../../components/erp/ERPEmptyState.js';
import Button from '../../../components/ui/Button.js';
import DatePicker from '../../../components/ui/DatePicker.js';
import { formatDate } from '../../../lib/format.js';

interface EventRecord {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion: number;
  correlationId: string | null;
  userId: number | null;
  occurredAt: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

const AGGREGATE_TYPES = ['', 'INVOICE', 'PAYMENT', 'CUSTOMER', 'ITEM', 'STOCK'];
const EVENT_TYPES = [
  '',
  'INVOICE_CREATED',
  'INVOICE_CONFIRMED',
  'INVOICE_CANCELLED',
  'PAYMENT_RECEIVED',
  'STOCK_DEDUCTED',
  'STOCK_RECEIVED',
];

export default function EventStorePage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [filters, setFilters] = useState({
    aggregateType: '',
    aggregateId: '',
    eventType: '',
    from: '',
    to: '',
  });
  const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
  const [replayTarget, setReplayTarget] = useState({ type: '', id: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['event-store', filters],
    queryFn: () => {
      const params: Parameters<typeof eventStoreApi.query>[0] = { limit: 100 };
      if (filters.aggregateType) params.aggregateType = filters.aggregateType;
      if (filters.aggregateId) params.aggregateId = filters.aggregateId;
      if (filters.eventType) params.eventType = filters.eventType;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      return eventStoreApi.query(params);
    },
  });
  const events: EventRecord[] = (data as unknown as EventRecord[]) ?? [];

  const replayMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) => eventStoreApi.replay(type, id),
    onSuccess: () => {
      toast.success('Aggregate state rebuilt from event history');
      void qc.invalidateQueries({ queryKey: ['event-store'] });
    },
    onError: () => toast.error('Replay failed'),
  });

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Event Store"
        subtitle="Browse append-only domain event log"
      />

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Aggregate Type</label>
            <select
              value={filters.aggregateType}
              onChange={(e) => setFilters((f) => ({ ...f, aggregateType: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-default bg-surface-card text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {AGGREGATE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t || 'All Types'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Aggregate ID</label>
            <input
              type="text"
              value={filters.aggregateId}
              onChange={(e) => setFilters((f) => ({ ...f, aggregateId: e.target.value }))}
              placeholder="e.g. 42"
              className="w-full px-3 py-2 rounded-lg border border-default bg-surface-card text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Event Type</label>
            <select
              value={filters.eventType}
              onChange={(e) => setFilters((f) => ({ ...f, eventType: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-default bg-surface-card text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t || 'All Events'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <DatePicker
              label="From"
              value={filters.from}
              onChange={(v) => setFilters((f) => ({ ...f, from: v }))}
            />
          </div>
          <div>
            <DatePicker
              label="To"
              value={filters.to}
              onChange={(v) => setFilters((f) => ({ ...f, to: v }))}
            />
          </div>
        </div>
      </div>

      {/* Replay form */}
      {hasPermission(PERMISSIONS.EVENT_STORE_VIEW) && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-primary mb-3">Rebuild Aggregate State</h3>
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">
                Aggregate Type
              </label>
              <input
                type="text"
                value={replayTarget.type}
                onChange={(e) => setReplayTarget((t) => ({ ...t, type: e.target.value }))}
                placeholder="INVOICE"
                className="w-40 px-3 py-2 rounded-lg border border-default bg-surface-card text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Aggregate ID</label>
              <input
                type="text"
                value={replayTarget.id}
                onChange={(e) => setReplayTarget((t) => ({ ...t, id: e.target.value }))}
                placeholder="42"
                className="w-32 px-3 py-2 rounded-lg border border-default bg-surface-card text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={replayMutation.isPending}
              disabled={!replayTarget.type || !replayTarget.id}
              onClick={() =>
                replayMutation.mutate({ type: replayTarget.type, id: replayTarget.id })
              }
            >
              Rebuild State
            </Button>
          </div>
        </div>
      )}

      {/* Events table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={6} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Event Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Aggregate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    v
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Occurred At
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Correlation
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((ev) => (
                  <tr key={ev.eventId} className="hover:bg-surface-hover">
                    <td className="px-4 py-3 font-medium text-primary">{ev.eventType}</td>
                    <td className="px-4 py-3 text-secondary">
                      {ev.aggregateType}/{ev.aggregateId}
                    </td>
                    <td className="px-4 py-3 text-secondary">{ev.schemaVersion}</td>
                    <td className="px-4 py-3 text-secondary">{formatDate(ev.occurredAt)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-secondary truncate max-w-[120px]">
                      {ev.correlationId ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedEvent(ev)}>
                        Inspect
                      </Button>
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <ERPEmptyState
                        type="no-results"
                        title="No events match the current filters"
                        description="Try adjusting your filters."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event detail modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-surface-card rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-primary mb-4">{selectedEvent.eventType}</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-secondary">Event ID</dt>
                <dd className="font-mono text-xs text-primary">{selectedEvent.eventId}</dd>
              </div>
              <div>
                <dt className="text-secondary">Aggregate</dt>
                <dd className="text-primary">
                  {selectedEvent.aggregateType}/{selectedEvent.aggregateId}
                </dd>
              </div>
              <div>
                <dt className="text-secondary">Schema Version</dt>
                <dd className="text-primary">{selectedEvent.schemaVersion}</dd>
              </div>
              <div>
                <dt className="text-secondary">Occurred At</dt>
                <dd className="text-primary">{formatDate(selectedEvent.occurredAt)}</dd>
              </div>
              <div>
                <dt className="text-secondary">User ID</dt>
                <dd className="text-primary">{selectedEvent.userId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-secondary mb-1">Payload</dt>
                <dd>
                  <pre className="bg-surface-hover rounded p-3 text-xs overflow-x-auto">
                    {JSON.stringify(selectedEvent.payload, null, 2)}
                  </pre>
                </dd>
              </div>
              {Object.keys(selectedEvent.metadata ?? {}).length > 0 && (
                <div>
                  <dt className="text-secondary mb-1">Metadata</dt>
                  <dd>
                    <pre className="bg-surface-hover rounded p-3 text-xs overflow-x-auto">
                      {JSON.stringify(selectedEvent.metadata, null, 2)}
                    </pre>
                  </dd>
                </div>
              )}
            </dl>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setSelectedEvent(null)}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
