import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate } from '../../lib/format.js';

interface Season {
  id: number;
  name: string;
  seasonType: 'FESTIVAL_SEASON' | 'WEDDING_SEASON' | 'SUMMER_COLLECTION' | 'YEAR_END_SALE';
  startDate: string;
  endDate: string;
  stockMultiplier: number;
  loyaltyMultiplier: number;
  salesTarget?: number;
  isActive: boolean;
  version: number;
}

export default function SeasonsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.CRM_SEASON_MANAGE);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-seasons'],
    queryFn: () => crmApi.listSeasons(),
  });
  const seasons: Season[] = (data as { content?: Season[] })?.content ?? [];

  const { data: activeData } = useQuery({
    queryKey: ['crm-active-season'],
    queryFn: () => crmApi.activeSeason(),
  });
  const active = activeData as Season | null | undefined;

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Festival Season Planner"
        subtitle="Manage business seasons, stock multipliers, and loyalty bonuses"
        actions={
          canManage ? (
            <Button onClick={() => navigate('/crm/seasons/new')}>+ New Season</Button>
          ) : undefined
        }
      />

      {/* Active season banner */}
      {active && (
        <div className="mb-6 bg-primary-subtle border border-primary/20 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-brand">Active Season: {active.name}</p>
            <p className="text-xs text-secondary mt-0.5">
              {formatDate(active.startDate)} – {formatDate(active.endDate)} ·{' '}
              {active.stockMultiplier}× stock · {active.loyaltyMultiplier}× loyalty
            </p>
          </div>
          <Badge label="ACTIVE" color="green" />
        </div>
      )}

      {/* Seasons list */}
      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={6} cols={4} />
        ) : seasons.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No seasons configured yet"
            description="Manage business seasons, stock multipliers, and loyalty bonuses."
            {...(canManage
              ? { action: { label: '+ New Season', onClick: () => navigate('/crm/seasons/new') } }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {seasons.map((s) => {
              const today = new Date();
              const start = new Date(s.startDate);
              const end = new Date(s.endDate);
              const daysTotal = Math.ceil((end.getTime() - start.getTime()) / 86400000);
              const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86400000);
              const pct =
                daysTotal > 0
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        Math.round(((daysTotal - Math.max(0, daysLeft)) / daysTotal) * 100)
                      )
                    )
                  : 0;
              return (
                <div key={s.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-primary">{s.name}</p>
                        {s.isActive && <Badge label="ACTIVE" color="green" />}
                        <Badge label={s.seasonType.replace(/_/g, ' ')} color="blue" />
                      </div>
                      <p className="text-xs text-secondary mt-0.5">
                        {formatDate(s.startDate)} – {formatDate(s.endDate)} · {s.stockMultiplier}×
                        stock · {s.loyaltyMultiplier}× loyalty
                        {s.salesTarget ? ` · Target ₹${s.salesTarget.toLocaleString()}` : ''}
                      </p>
                      <div className="mt-2 max-w-xs">
                        <div className="flex justify-between text-xs text-secondary mb-0.5">
                          <span>Progress</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    {canManage && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`/crm/seasons/${s.id}/edit`)}
                      >
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
