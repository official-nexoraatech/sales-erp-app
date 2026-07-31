import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fieldVisitApi, customerApi, userApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface VisitRoute {
  id: number;
  name: string;
  assignedTo: number;
  scheduledDate: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
  version: number;
}

interface StaffUser {
  id: number;
  firstName: string;
  lastName: string;
}

interface RouteProgress {
  stops: Array<{
    id: number;
    customerId: number;
    customerName: string | null;
    sequenceNumber: number;
    status: string;
  }>;
  completedCount: number;
  totalCount: number;
}

function RouteStopsPanel({ routeId }: { routeId: number }): React.ReactElement {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['visit-route-progress', routeId],
    queryFn: () => fieldVisitApi.routeProgress(routeId) as Promise<{ data: RouteProgress }>,
    select: (res) => res.data,
  });
  const [customerSearch, setCustomerSearch] = useState('');
  const { data: customerResults } = useQuery({
    queryKey: ['customer-search-for-route', customerSearch],
    queryFn: () => customerApi.list({ search: customerSearch, size: 5 }),
    enabled: customerSearch.length >= 2,
  });
  const candidates =
    (customerResults as { content?: Array<{ id: number; displayName: string }> })?.content ?? [];

  const addStopMut = useMutation({
    mutationFn: (customerId: number) => {
      const existing =
        data?.stops.map((s) => ({ customerId: s.customerId, sequenceNumber: s.sequenceNumber })) ??
        [];
      return fieldVisitApi.setRouteStops(routeId, [
        ...existing,
        { customerId, sequenceNumber: existing.length },
      ]);
    },
    onSuccess: () => {
      toast.success('Stop added');
      setCustomerSearch('');
      void queryClient.invalidateQueries({ queryKey: ['visit-route-progress', routeId] });
    },
    onError: () => toast.error('Could not add stop'),
  });

  if (isLoading || !data) return <p className="text-xs text-secondary px-5 py-2">Loading stops…</p>;

  return (
    <div className="px-5 py-3 bg-surface-subtle space-y-2">
      <p className="text-xs text-secondary">
        {data.completedCount} of {data.totalCount} stops completed
      </p>
      {data.stops.map((s) => (
        <div key={s.id} className="flex items-center justify-between text-xs">
          <span>
            {s.sequenceNumber + 1}. {s.customerName ?? `Customer #${s.customerId}`}
          </span>
          <Badge
            label={s.status}
            color={s.status === 'VISITED' ? 'green' : s.status === 'SKIPPED' ? 'gray' : 'blue'}
          />
        </div>
      ))}
      <div className="pt-2 relative">
        <input
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
          placeholder="Search customer to add a stop…"
          className="w-full rounded-md border border-default bg-surface-page px-2 py-1 text-xs"
        />
        {candidates.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-default bg-surface-card shadow-token-md">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => addStopMut.mutate(c.id)}
                className="block w-full text-left px-2 py-1.5 text-xs hover:bg-surface-subtle"
              >
                {c.displayName}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function VisitRoutesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [assignedTo, setAssignedTo] = useState<number | ''>('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['visit-routes'],
    queryFn: () => fieldVisitApi.listRoutes(),
  });
  const routes = ((data as { content?: VisitRoute[] })?.content ?? []) as VisitRoute[];

  const { data: userData } = useQuery({
    queryKey: ['users-for-routes'],
    queryFn: () => userApi.list(),
  });
  const staffUsers = ((userData as { content?: StaffUser[] })?.content ?? []) as StaffUser[];

  const createMut = useMutation({
    mutationFn: () =>
      fieldVisitApi.createRoute({
        name,
        assignedTo: assignedTo as number,
        scheduledDate: new Date(scheduledDate).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Route created');
      setName('');
      setAssignedTo('');
      setScheduledDate('');
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ['visit-routes'] });
    },
    onError: () => toast.error('Could not create route'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Field Sales Routes"
        subtitle="Plan visit routes and track rep progress against them"
        actions={
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Route'}
          </Button>
        }
      />

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="mb-6 space-y-3 rounded-xl border border-default bg-surface-card p-4"
        >
          <div>
            <label className="text-xs text-secondary">Route Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-secondary">Assigned Rep</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : '')}
                required
                className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {staffUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-secondary">Scheduled Date</label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
              />
            </div>
          </div>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Route'}
          </Button>
        </form>
      )}

      <div className="bg-surface-card rounded-xl border border-default">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">All Routes</h2>
        </div>
        {isLoading ? (
          <div className="p-4">
            <ERPCardSkeleton lines={2} />
          </div>
        ) : routes.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No routes planned yet"
            description="Create a route and assign stops so reps know who to visit and in what order."
            action={{ label: '+ New Route', onClick: () => setShowForm(true) }}
          />
        ) : (
          <div className="divide-y divide-default">
            {routes.map((r) => (
              <div key={r.id}>
                <div className="flex items-center justify-between px-5 py-3 flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-primary">{r.name}</p>
                      <Badge
                        label={r.status}
                        color={
                          r.status === 'COMPLETED'
                            ? 'green'
                            : r.status === 'IN_PROGRESS'
                              ? 'blue'
                              : 'gray'
                        }
                      />
                    </div>
                    <p className="text-xs text-secondary">{formatDate(r.scheduledDate)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                  >
                    {expandedId === r.id ? 'Hide Stops' : 'Manage Stops'}
                  </Button>
                </div>
                {expandedId === r.id && <RouteStopsPanel routeId={r.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
