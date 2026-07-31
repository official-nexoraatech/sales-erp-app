import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fieldVisitApi, customerApi } from '../../api/endpoints.js';
import { salesServiceUrl } from '../../api/client.js';
import { useAuthStore } from '../../store/auth.store.js';
import {
  submitOrQueueVisitAction,
  flushVisitQueue,
  listQueuedVisitActions,
} from '../../lib/offlineVisitQueue.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface VisitRoute {
  id: number;
  name: string;
  scheduledDate: string;
  status: string;
}

interface RouteStop {
  id: number;
  customerId: number;
  customerName: string | null;
  sequenceNumber: number;
  status: 'PENDING' | 'VISITED' | 'SKIPPED';
  visitId: number | null;
}

function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

async function getGpsPosition(): Promise<{ lat?: number; lng?: number }> {
  if (!('geolocation' in navigator)) return {};
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({}), // permission denied / unavailable — a visit can still be logged without GPS
      { timeout: 5000 }
    );
  });
}

function RouteCard({ route }: { route: VisitRoute }): React.ReactElement {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['visit-route-progress', route.id],
    queryFn: () =>
      fieldVisitApi.routeProgress(route.id) as Promise<{ data: { stops: RouteStop[] } }>,
    select: (res) => res.data,
  });
  const stops = data?.stops ?? [];

  const checkInMut = useMutation({
    mutationFn: async (stop: RouteStop) => {
      const { lat, lng } = await getGpsPosition();
      return submitOrQueueVisitAction(
        {
          url: `${salesServiceUrl()}/field-visits`,
          method: 'POST',
          body: {
            customerId: stop.customerId,
            routeStopId: stop.id,
            ...(lat !== undefined ? { checkInLat: lat } : {}),
            ...(lng !== undefined ? { checkInLng: lng } : {}),
            clientOperationId: crypto.randomUUID(),
          },
        },
        getAccessToken
      );
    },
    onSuccess: (result) => {
      toast.success(
        result.queued ? 'Offline — check-in saved, will sync automatically' : 'Checked in'
      );
      void queryClient.invalidateQueries({ queryKey: ['visit-route-progress', route.id] });
    },
    onError: () => toast.error('Could not check in'),
  });

  return (
    <div className="rounded-xl border border-default bg-surface-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">{route.name}</p>
        <Badge label={route.status} color={route.status === 'COMPLETED' ? 'green' : 'blue'} />
      </div>
      <p className="text-xs text-secondary mt-0.5">{formatDate(route.scheduledDate)}</p>
      <div className="mt-3 space-y-2">
        {stops.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-md border border-default px-3 py-2"
          >
            <div>
              <p className="text-sm text-primary">
                {s.sequenceNumber + 1}. {s.customerName ?? `Customer #${s.customerId}`}
              </p>
              <Badge label={s.status} color={s.status === 'VISITED' ? 'green' : 'gray'} />
            </div>
            {s.status === 'PENDING' && (
              <Button
                size="sm"
                disabled={checkInMut.isPending}
                onClick={() => checkInMut.mutate(s)}
              >
                Check In
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdHocVisitPanel(): React.ReactElement {
  const [search, setSearch] = useState('');
  const { data: customerResults } = useQuery({
    queryKey: ['customer-search-for-adhoc-visit', search],
    queryFn: () => customerApi.list({ search, size: 5 }),
    enabled: search.length >= 2,
  });
  const candidates =
    (customerResults as { content?: Array<{ id: number; displayName: string }> })?.content ?? [];

  const checkInMut = useMutation({
    mutationFn: async (customerId: number) => {
      const { lat, lng } = await getGpsPosition();
      return submitOrQueueVisitAction(
        {
          url: `${salesServiceUrl()}/field-visits`,
          method: 'POST',
          body: {
            customerId,
            ...(lat !== undefined ? { checkInLat: lat } : {}),
            ...(lng !== undefined ? { checkInLng: lng } : {}),
            clientOperationId: crypto.randomUUID(),
          },
        },
        getAccessToken
      );
    },
    onSuccess: (result) => {
      toast.success(
        result.queued ? 'Offline — visit saved, will sync automatically' : 'Checked in'
      );
      setSearch('');
    },
    onError: () => toast.error('Could not check in'),
  });

  return (
    <div className="rounded-xl border border-default bg-surface-card p-4">
      <h2 className="text-sm font-semibold text-primary mb-2">Unplanned Visit</h2>
      <p className="text-xs text-secondary mb-2">
        Not on today's route? Check in against any customer directly.
      </p>
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer…"
          className="w-full rounded-md border border-default bg-surface-page px-3 py-2 text-sm"
        />
        {candidates.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-default bg-surface-card shadow-token-md">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={checkInMut.isPending}
                onClick={() => checkInMut.mutate(c.id)}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-surface-subtle"
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

export default function FieldVisitsPage(): React.ReactElement {
  const [pendingCount, setPendingCount] = useState(0);

  async function refreshPendingCount(): Promise<void> {
    const pending = await listQueuedVisitActions();
    setPendingCount(pending.length);
  }

  async function syncNow(): Promise<void> {
    const { flushed, remaining } = await flushVisitQueue(getAccessToken);
    if (flushed > 0) toast.success(`Synced ${flushed} queued check-in${flushed === 1 ? '' : 's'}`);
    setPendingCount(remaining);
  }

  useEffect(() => {
    void refreshPendingCount();
    const onOnline = (): void => {
      void syncNow();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['visit-routes'],
    queryFn: () => fieldVisitApi.listRoutes(),
  });
  const routes = ((data as { content?: VisitRoute[] })?.content ?? []) as VisitRoute[];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="My Routes"
        subtitle="Today's field visits — check in and out as you go"
      />

      {pendingCount > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-warning bg-warning-subtle px-4 py-3">
          <p className="text-xs text-primary">
            {pendingCount} check-in{pendingCount === 1 ? '' : 's'} waiting to sync
          </p>
          <Button size="sm" variant="secondary" onClick={() => void syncNow()}>
            Sync Now
          </Button>
        </div>
      )}

      <div className="space-y-4 mb-4">
        {isLoading ? (
          <ERPCardSkeleton lines={3} />
        ) : routes.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No routes assigned"
            description="Your distribution manager hasn't planned a route for you yet."
          />
        ) : (
          routes.map((r) => <RouteCard key={r.id} route={r} />)
        )}
      </div>

      <AdHocVisitPanel />
    </div>
  );
}
