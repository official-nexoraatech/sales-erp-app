import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { loyaltyApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';

interface LoyaltyTier {
  id: number;
  name: string;
  code: string;
  minLifetimePoints: number;
  benefits: string | null;
  isActive: boolean;
}

interface RedemptionCatalogItem {
  id: number;
  name: string;
  description: string | null;
  pointsCost: number;
  rewardType: 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT';
  rewardValue: string;
  isActive: boolean;
}

// CRM-ROADMAP Phase 2, Feature 3 (Loyalty & Rewards — Tiering Layer). Tiers are derived from
// lifetime points earned server-side (LoyaltyService.evaluateTier) — this page only configures
// the thresholds/benefits, it never assigns a tier directly.
function TiersSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['loyalty-tiers'],
    queryFn: () => loyaltyApi.listTiers(),
  });
  const tiers: LoyaltyTier[] = (data as { content?: LoyaltyTier[] })?.content ?? [];

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [minLifetimePoints, setMinLifetimePoints] = useState('');
  const [benefits, setBenefits] = useState('');

  const createMut = useMutation({
    mutationFn: () =>
      loyaltyApi.createTier({
        name,
        code,
        minLifetimePoints: Number(minLifetimePoints),
        ...(benefits ? { benefits } : {}),
      }),
    onSuccess: () => {
      toast.success('Tier created');
      qc.invalidateQueries({ queryKey: ['loyalty-tiers'] });
      setName('');
      setCode('');
      setMinLifetimePoints('');
      setBenefits('');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to create tier'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      loyaltyApi.updateTier(id, { isActive }),
    onSuccess: () => {
      toast.success('Tier updated');
      qc.invalidateQueries({ queryKey: ['loyalty-tiers'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to update tier'),
  });

  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-6">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Loyalty Tiers
      </h2>

      {isLoading ? (
        <ERPFormSkeleton />
      ) : tiers.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No tiers configured"
          description="Customers won't show a tier badge until at least one is added."
        />
      ) : (
        <div className="divide-y divide-default">
          {tiers.map((t) => (
            <div key={t.id} className="flex items-center gap-4 py-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-primary">{t.name}</p>
                  <Badge
                    label={t.isActive ? 'Active' : 'Inactive'}
                    color={t.isActive ? 'green' : 'gray'}
                  />
                </div>
                <p className="text-xs text-secondary mt-0.5">
                  From {t.minLifetimePoints} lifetime points{t.benefits ? ` — ${t.benefits}` : ''}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toggleMut.mutate({ id: t.id, isActive: !t.isActive })}
                disabled={toggleMut.isPending}
              >
                {t.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-default">
        <Input
          label="Tier Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Gold"
        />
        <Input
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="gold"
        />
        <Input
          type="number"
          min={0}
          label="Min. Lifetime Points"
          value={minLifetimePoints}
          onChange={(e) => setMinLifetimePoints(e.target.value)}
        />
        <Input
          label="Benefits (optional)"
          value={benefits}
          onChange={(e) => setBenefits(e.target.value)}
          placeholder="Free alterations, priority support"
        />
      </div>
      <Button
        onClick={() => createMut.mutate()}
        disabled={createMut.isPending || !name || !code || !minLifetimePoints}
      >
        + Add Tier
      </Button>
    </div>
  );
}

function CatalogSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['loyalty-catalog'],
    queryFn: () => loyaltyApi.listCatalog(),
  });
  const items: RedemptionCatalogItem[] =
    (data as { content?: RedemptionCatalogItem[] })?.content ?? [];

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pointsCost, setPointsCost] = useState('');
  const [rewardType, setRewardType] = useState<'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT'>(
    'DISCOUNT_AMOUNT'
  );
  const [rewardValue, setRewardValue] = useState('');

  const createMut = useMutation({
    mutationFn: () =>
      loyaltyApi.createCatalogItem({
        name,
        ...(description ? { description } : {}),
        pointsCost: Number(pointsCost),
        rewardType,
        rewardValue: Number(rewardValue),
      }),
    onSuccess: () => {
      toast.success('Reward added to catalog');
      qc.invalidateQueries({ queryKey: ['loyalty-catalog'] });
      setName('');
      setDescription('');
      setPointsCost('');
      setRewardValue('');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to add reward'),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: number) => loyaltyApi.updateCatalogItem(id, { isActive: false }),
    onSuccess: () => {
      toast.success('Reward removed from catalog');
      qc.invalidateQueries({ queryKey: ['loyalty-catalog'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to remove reward'),
  });

  return (
    <div className="bg-surface-card rounded-xl border border-default p-5 space-y-6">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
        Redemption Catalog
      </h2>

      {isLoading ? (
        <ERPFormSkeleton />
      ) : items.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No rewards yet"
          description="POS checkout offers only the raw points-to-discount redemption until a reward is added here."
        />
      ) : (
        <div className="divide-y divide-default">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-4 py-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-primary">{item.name}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {item.pointsCost} points —{' '}
                  {item.rewardType === 'DISCOUNT_PERCENT'
                    ? `${item.rewardValue}% off`
                    : `₹${item.rewardValue} off`}
                  {item.description ? ` — ${item.description}` : ''}
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => deactivateMut.mutate(item.id)}
                disabled={deactivateMut.isPending}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-default">
        <Input
          label="Reward Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="10% Off Voucher"
        />
        <Input
          label="Points Cost"
          type="number"
          min={1}
          value={pointsCost}
          onChange={(e) => setPointsCost(e.target.value)}
        />
        <Select
          label="Reward Type"
          value={rewardType}
          onChange={(e) => setRewardType(e.target.value as 'DISCOUNT_AMOUNT' | 'DISCOUNT_PERCENT')}
        >
          <option value="DISCOUNT_AMOUNT">Flat discount (₹)</option>
          <option value="DISCOUNT_PERCENT">Percentage discount (%)</option>
        </Select>
        <Input
          label={rewardType === 'DISCOUNT_PERCENT' ? 'Discount %' : 'Discount ₹'}
          type="number"
          min={0}
          value={rewardValue}
          onChange={(e) => setRewardValue(e.target.value)}
        />
        <Input
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <Button
        onClick={() => createMut.mutate()}
        disabled={createMut.isPending || !name || !pointsCost || !rewardValue}
      >
        + Add Reward
      </Button>
    </div>
  );
}

export default function LoyaltyProgramPage() {
  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Loyalty Program"
        subtitle="Configure tiers and the points-redemption catalog"
      />
      <TiersSection />
      <CatalogSection />
    </div>
  );
}
