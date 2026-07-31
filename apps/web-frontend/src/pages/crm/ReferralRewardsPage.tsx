import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { referralApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDatetime } from '../../lib/format.js';

interface ReferralReward {
  id: number;
  referrerCustomerId: number;
  refereePhone: string;
  refereeName: string | null;
  status: 'PENDING' | 'FLAGGED' | 'PAID' | 'REJECTED';
  referrerPoints: number;
  refereePoints: number;
  flagReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

interface FunnelStats {
  clicked: number;
  signedUp: number;
  paid: number;
  flagged: number;
  rejected: number;
}

const STATUS_COLORS: Record<string, 'green' | 'yellow' | 'red' | 'gray'> = {
  PENDING: 'gray',
  FLAGGED: 'yellow',
  PAID: 'green',
  REJECTED: 'red',
};

// CRM-ROADMAP Phase 2, Feature 4 — the roadmap's own required abuse-review path: a FLAGGED
// reward (device/address correlation) never auto-pays until approved here.
export default function ReferralRewardsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [statusFilter, setStatusFilter] = useState<
    '' | 'PENDING' | 'FLAGGED' | 'PAID' | 'REJECTED'
  >('FLAGGED');
  const [rejectingId, setRejectingId] = useState<number | null>(null);

  const { data: funnelData } = useQuery({
    queryKey: ['referral-funnel'],
    queryFn: () => referralApi.getFunnel(),
  });
  const funnel = funnelData as FunnelStats | undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['referral-rewards', statusFilter],
    queryFn: () => referralApi.listRewards(statusFilter || undefined),
  });
  const rewards: ReferralReward[] = (data as { content?: ReferralReward[] })?.content ?? [];

  const approveMut = useMutation({
    mutationFn: (id: number) => referralApi.approveReward(id),
    onSuccess: () => {
      toast.success('Reward approved — will pay out once the referee makes a qualifying purchase');
      qc.invalidateQueries({ queryKey: ['referral-rewards'] });
      qc.invalidateQueries({ queryKey: ['referral-funnel'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve reward'),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      referralApi.rejectReward(id, reason),
    onSuccess: () => {
      toast.success('Reward rejected');
      qc.invalidateQueries({ queryKey: ['referral-rewards'] });
      qc.invalidateQueries({ queryKey: ['referral-funnel'] });
      setRejectingId(null);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to reject reward'),
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Referral Rewards"
        subtitle="Review flagged referrals and track the shared → clicked → signed up → purchased funnel"
      />

      {funnel && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
          {(
            [
              ['Clicked', funnel.clicked],
              ['Signed Up', funnel.signedUp],
              ['Paid', funnel.paid],
              ['Flagged', funnel.flagged],
              ['Rejected', funnel.rejected],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="bg-surface-card rounded-xl border border-default p-4 text-center"
            >
              <p className="text-xs text-disabled uppercase tracking-wide mb-1">{label}</p>
              <p className="text-lg font-bold text-primary">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-2 flex-wrap">
        {(['', 'PENDING', 'FLAGGED', 'PAID', 'REJECTED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              statusFilter === s
                ? 'bg-primary text-white border-primary'
                : 'border-default text-secondary hover:bg-surface-raised'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={5} cols={4} />
        ) : rewards.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No referral rewards found"
            description="Referral redemptions will appear here as customers share their codes."
          />
        ) : (
          <div className="divide-y divide-default">
            {rewards.map((r) => (
              <div key={r.id} className="px-5 py-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-primary">
                        {r.refereeName || r.refereePhone}
                      </p>
                      <Badge label={r.status} color={STATUS_COLORS[r.status] ?? 'gray'} />
                    </div>
                    <p className="text-xs text-secondary mt-0.5">
                      Referred by customer #{r.referrerCustomerId} — {r.referrerPoints} /{' '}
                      {r.refereePoints} pts
                      {r.paidAt
                        ? ` — paid ${formatDatetime(r.paidAt)}`
                        : ` — created ${formatDatetime(r.createdAt)}`}
                    </p>
                    {r.flagReason && <p className="text-xs text-danger mt-1">{r.flagReason}</p>}
                  </div>
                  {r.status === 'FLAGGED' && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => approveMut.mutate(r.id)}
                        disabled={approveMut.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={async () => {
                          const ok = await confirm({
                            title: 'Reject Referral Reward',
                            message: `Reject the referral reward for ${r.refereeName || r.refereePhone}? This cannot be undone.`,
                            confirmLabel: 'Reject',
                            variant: 'danger',
                          });
                          if (ok) {
                            setRejectingId(r.id);
                            rejectMut.mutate({ id: r.id, reason: 'Rejected after fraud review' });
                          }
                        }}
                        disabled={rejectMut.isPending && rejectingId === r.id}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
