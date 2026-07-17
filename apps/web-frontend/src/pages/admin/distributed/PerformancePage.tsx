import { useQuery } from '@tanstack/react-query';
import { performanceAdminApi } from '../../../api/endpoints.js';
import ERPPageHeader from '../../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../../components/erp/ERPEmptyState.js';
import Badge from '../../../components/ui/Badge.js';
import { formatDate } from '../../../lib/format.js';

interface PerformanceBaseline {
  endpoint: string;
  method: string;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
  measuredAt: string;
}

interface PerformanceTarget {
  endpoint: string;
  method: string;
  targetP95Ms: number;
}

function statusVariant(actual: number, target: number): 'success' | 'warning' | 'danger' {
  if (actual <= target) return 'success';
  if (actual <= target * 1.5) return 'warning';
  return 'danger';
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

export default function PerformancePage() {
  const { data: baselinesData, isLoading: baselinesLoading } = useQuery({
    queryKey: ['perf-baselines'],
    queryFn: () => performanceAdminApi.baselines(),
    refetchInterval: 60_000,
  });
  const baselines: PerformanceBaseline[] =
    (baselinesData as unknown as PerformanceBaseline[]) ?? [];

  const { data: targetsData } = useQuery({
    queryKey: ['perf-targets'],
    queryFn: () => performanceAdminApi.targets(),
  });
  const targets: PerformanceTarget[] = (targetsData as unknown as PerformanceTarget[]) ?? [];

  const targetMap = new Map(targets.map((t) => [`${t.method}:${t.endpoint}`, t.targetP95Ms]));

  const breachCount = baselines.filter((b) => {
    const target = targetMap.get(`${b.method}:${b.endpoint}`);
    return target !== undefined && b.p95Ms > target;
  }).length;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Performance Baselines"
        subtitle="P50/P95/P99 latency measurements vs. targets"
      />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">ENDPOINTS TRACKED</p>
          <p className="text-2xl font-bold text-primary">{baselines.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">TARGETS CONFIGURED</p>
          <p className="text-2xl font-bold text-primary">{targets.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">P95 BREACHES</p>
          <p className={`text-2xl font-bold ${breachCount > 0 ? 'text-danger' : 'text-success'}`}>
            {breachCount}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary mb-1">WITHIN TARGET</p>
          <p className="text-2xl font-bold text-success">{baselines.length - breachCount}</p>
        </div>
      </div>

      {breachCount > 0 && (
        <div className="rounded-lg bg-danger/10 border border-danger/20 px-4 py-3 text-sm text-danger font-medium">
          {breachCount} endpoint{breachCount > 1 ? 's are' : ' is'} exceeding P95 latency target.
        </div>
      )}

      {/* Baselines table */}
      <div className="card overflow-hidden">
        {baselinesLoading ? (
          <ERPTableSkeleton rows={6} cols={8} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-hover">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Endpoint
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    P50
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    P95
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    P99
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Samples
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary uppercase">
                    Measured
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {baselines.map((b) => {
                  const target = targetMap.get(`${b.method}:${b.endpoint}`);
                  const variant =
                    target !== undefined ? statusVariant(b.p95Ms, target) : ('default' as const);
                  return (
                    <tr key={`${b.method}:${b.endpoint}`} className="hover:bg-surface-hover">
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-secondary mr-2">{b.method}</span>
                        <span className="font-medium text-primary">{b.endpoint}</span>
                      </td>
                      <td className="px-4 py-3 text-secondary">
                        {target !== undefined ? formatMs(target) : '—'}
                      </td>
                      <td className="px-4 py-3 text-primary">{formatMs(b.p50Ms)}</td>
                      <td
                        className={`px-4 py-3 font-semibold ${variant === 'success' ? 'text-success' : variant === 'warning' ? 'text-warning' : variant === 'danger' ? 'text-danger' : 'text-primary'}`}
                      >
                        {formatMs(b.p95Ms)}
                      </td>
                      <td className="px-4 py-3 text-primary">{formatMs(b.p99Ms)}</td>
                      <td className="px-4 py-3 text-secondary">{b.sampleCount.toLocaleString()}</td>
                      <td className="px-4 py-3">
                        {target !== undefined ? (
                          <Badge variant={variant}>
                            {variant === 'success'
                              ? 'OK'
                              : variant === 'warning'
                                ? 'SLOW'
                                : 'BREACH'}
                          </Badge>
                        ) : (
                          <Badge variant="default">NO TARGET</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-secondary">{formatDate(b.measuredAt)}</td>
                    </tr>
                  );
                })}
                {baselines.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <ERPEmptyState
                        type="no-data"
                        title="No baseline measurements recorded yet"
                        description="Latency measurements will appear here once endpoints are exercised."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Targets */}
      {targets.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-primary mb-3">Configured Targets</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {targets.map((t) => (
              <div
                key={`${t.method}:${t.endpoint}`}
                className="px-3 py-2 rounded-lg bg-surface-hover"
              >
                <p className="text-xs text-secondary">
                  {t.method} {t.endpoint}
                </p>
                <p className="text-sm font-bold text-primary">{formatMs(t.targetP95Ms)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
