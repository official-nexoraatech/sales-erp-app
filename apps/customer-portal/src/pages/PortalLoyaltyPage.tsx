import { useQuery } from '@tanstack/react-query';
import { portalApiClient } from '../api/portalApiClient.js';

interface LoyaltyHistoryEntry {
  id: number;
  type: string;
  points: number;
  createdAt: string;
}

interface LoyaltyBalance {
  points: number;
  redeemValue: number;
  tier: string | null;
  nextTier: { name: string; pointsNeeded: number } | null;
  history: LoyaltyHistoryEntry[];
}

export function PortalLoyaltyPage(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'loyalty'],
    queryFn: () => portalApiClient.get<LoyaltyBalance>('sales', '/portal/loyalty'),
  });

  if (isLoading) return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;
  if (!data)
    return <p className="text-sm text-[var(--text-secondary)]">Loyalty data unavailable.</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Rewards</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="text-xs text-[var(--text-secondary)]">Points balance</div>
          <div className="text-2xl font-semibold">{data.points}</div>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="text-xs text-[var(--text-secondary)]">Redeemable value</div>
          <div className="text-2xl font-semibold">₹{data.redeemValue}</div>
        </div>
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
          <div className="text-xs text-[var(--text-secondary)]">Tier</div>
          <div className="text-2xl font-semibold">{data.tier ?? '—'}</div>
          {data.nextTier && (
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              {data.nextTier.pointsNeeded} points to {data.nextTier.name}
            </div>
          )}
        </div>
      </div>

      <h2 className="text-sm font-medium text-[var(--text-secondary)]">Recent activity</h2>
      <div className="divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)]">
        {data.history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[var(--text-secondary)]">No activity yet.</p>
        ) : (
          data.history.map((h) => (
            <div key={h.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{h.type}</span>
              <span className="text-[var(--text-secondary)]">
                {new Date(h.createdAt).toLocaleDateString()}
              </span>
              <span className={h.points >= 0 ? 'text-green-600' : 'text-red-500'}>
                {h.points >= 0 ? '+' : ''}
                {h.points}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
