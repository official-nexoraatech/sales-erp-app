import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { projectionAdminApi } from '../../../api/endpoints.js';
import { useAuthStore } from '../../../store/auth.store.js';
import { PERMISSIONS } from '../../../constants/permissions.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import Button from '../../../components/ui/Button.js';
import Badge from '../../../components/ui/Badge.js';
import { formatDate } from '../../../lib/format.js';

interface ProjectionItem {
  projectionName: string;
  status: string;
  lastUpdatedAt: string | null;
  lastEventOccurredAt: string | null;
  _projection: {
    lastUpdatedAt: string | null;
    lagMs: number | null;
    isStale: boolean;
    staleTolerance: number;
  };
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  UP_TO_DATE: 'success',
  REBUILDING: 'info',
  STALE: 'warning',
  ERROR: 'danger',
};

function lagLabel(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export default function ProjectionsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const { data, isLoading } = useQuery({
    queryKey: ['projections'],
    queryFn: () => projectionAdminApi.list(),
    refetchInterval: 10_000,
  });
  const projections: ProjectionItem[] = (data as unknown as ProjectionItem[]) ?? [];

  const rebuildMutation = useMutation({
    mutationFn: (name: string) => projectionAdminApi.rebuild(name),
    onSuccess: (_, name) => {
      toast.success(`Rebuild triggered for ${name}`);
      void qc.invalidateQueries({ queryKey: ['projections'] });
    },
    onError: () => toast.error('Rebuild failed'),
  });

  const staleCount = projections.filter((p) => p._projection.isStale).length;

  return (
    <div className="space-y-6">
      <ERPPageHeader variant="list" title="CQRS Projections" subtitle="Monitor read model staleness and trigger rebuilds" />

      {/* Summary banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {['UP_TO_DATE', 'STALE', 'REBUILDING', 'ERROR'].map((status) => {
          const count = projections.filter((p) => p.status === status).length;
          return (
            <div key={status} className="card p-4">
              <p className="text-xs text-secondary mb-1">{status.replace('_', ' ')}</p>
              <p className="text-2xl font-bold text-primary">{count}</p>
            </div>
          );
        })}
      </div>

      {staleCount > 0 && (
        <div className="rounded-lg bg-warning/10 border border-warning/20 px-4 py-3 text-sm text-warning font-medium">
          {staleCount} projection{staleCount > 1 ? 's are' : ' is'} stale — consider triggering a rebuild.
        </div>
      )}

      {/* Projections list */}
      {isLoading ? (
        <div className="card p-8 text-center text-secondary">Loading projections…</div>
      ) : (
        <div className="space-y-3">
          {projections.map((proj) => (
            <div key={proj.projectionName} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-base font-semibold text-primary">{proj.projectionName}</h3>
                    <Badge variant={STATUS_VARIANT[proj.status] ?? 'default'}>{proj.status}</Badge>
                    {proj._projection.isStale && <Badge variant="warning">STALE</Badge>}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-secondary mb-0.5">Lag</p>
                      <p className={`font-semibold ${proj._projection.isStale ? 'text-warning' : 'text-success'}`}>
                        {lagLabel(proj._projection.lagMs)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-secondary mb-0.5">Stale Tolerance</p>
                      <p className="text-primary">{lagLabel(proj._projection.staleTolerance * 1000)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-secondary mb-0.5">Last Updated</p>
                      <p className="text-primary">{proj._projection.lastUpdatedAt ? formatDate(proj._projection.lastUpdatedAt) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-secondary mb-0.5">Last Event</p>
                      <p className="text-primary">{proj.lastEventOccurredAt ? formatDate(proj.lastEventOccurredAt) : '—'}</p>
                    </div>
                  </div>
                </div>
                {hasPermission(PERMISSIONS.PROJECTION_MANAGE) && (
                  <Button
                    size="sm"
                    variant={proj.status === 'REBUILDING' ? 'ghost' : 'secondary'}
                    disabled={proj.status === 'REBUILDING'}
                    loading={rebuildMutation.isPending && rebuildMutation.variables === proj.projectionName}
                    onClick={() => rebuildMutation.mutate(proj.projectionName)}
                  >
                    {proj.status === 'REBUILDING' ? 'Rebuilding…' : 'Rebuild'}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {projections.length === 0 && (
            <div className="card p-8 text-center text-secondary">No projections found</div>
          )}
        </div>
      )}
    </div>
  );
}
