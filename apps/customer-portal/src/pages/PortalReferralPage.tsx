import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { portalApiClient } from '../api/portalApiClient.js';

interface ReferralReward {
  id: number;
  refereeName: string | null;
  status: string;
  referrerPoints: number;
  createdAt: string;
}

interface ReferralData {
  code: string;
  rewards: ReferralReward[];
}

export function PortalReferralPage(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['portal', 'referral'],
    queryFn: () => portalApiClient.get<ReferralData>('sales', '/portal/referral'),
  });

  if (isLoading) return <p className="text-sm text-[var(--text-secondary)]">Loading…</p>;
  if (!data)
    return <p className="text-sm text-[var(--text-secondary)]">Referral data unavailable.</p>;

  // Same shareable-link format as web-frontend's CustomerViewPage (staff-facing referral
  // widget) — the gateway-fronted GET /r/:code click-tracking redirect, not this app's own
  // origin, which has no such route.
  const gatewayUrl = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000';
  const shareLink = `${gatewayUrl}/api/sales/r/${data.code}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Refer a Friend</h1>
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
        <div className="text-xs text-[var(--text-secondary)]">Your referral code</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="rounded bg-[var(--surface-subtle)] px-2 py-1 text-sm">{data.code}</code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(shareLink);
              toast.success('Link copied');
            }}
            className="rounded-md border border-[var(--border-default)] px-2 py-1 text-xs hover:bg-[var(--surface-subtle)]"
          >
            Copy link
          </button>
        </div>
      </div>

      <h2 className="text-sm font-medium text-[var(--text-secondary)]">Your referrals</h2>
      <div className="divide-y divide-[var(--border-default)] rounded-lg border border-[var(--border-default)]">
        {data.rewards.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[var(--text-secondary)]">
            No referrals yet — share your link to get started.
          </p>
        ) : (
          data.rewards.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>{r.refereeName ?? 'Pending signup'}</span>
              <span className="text-[var(--text-secondary)]">{r.status}</span>
              <span>{r.referrerPoints} pts</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
