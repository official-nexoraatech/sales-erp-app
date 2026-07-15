import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

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

const SEASON_TYPES = [
  'FESTIVAL_SEASON',
  'WEDDING_SEASON',
  'SUMMER_COLLECTION',
  'YEAR_END_SALE',
] as const;

const BLANK_FORM = {
  name: '',
  seasonType: 'FESTIVAL_SEASON' as Season['seasonType'],
  startDate: '',
  endDate: '',
  stockMultiplier: '1.5',
  loyaltyMultiplier: '2.0',
  salesTarget: '',
};

const LIST_PATH = '/crm/seasons';

export default function SeasonFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const [form, setForm] = useState({ ...BLANK_FORM });

  const { data, isLoading } = useQuery({
    queryKey: ['crm-seasons'],
    queryFn: () => crmApi.listSeasons(),
    enabled: isEdit,
  });
  const seasons: Season[] = (data as { content?: Season[] })?.content ?? [];
  const season = isEdit ? seasons.find((s) => s.id === Number(id)) : undefined;

  useEffect(() => {
    if (!season) return;
    setForm({
      name: season.name,
      seasonType: season.seasonType,
      startDate: season.startDate.slice(0, 10),
      endDate: season.endDate.slice(0, 10),
      stockMultiplier: String(season.stockMultiplier),
      loyaltyMultiplier: String(season.loyaltyMultiplier),
      salesTarget: season.salesTarget != null ? String(season.salesTarget) : '',
    });
  }, [season]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        seasonType: form.seasonType,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        stockMultiplier: parseFloat(form.stockMultiplier),
        loyaltyMultiplier: parseFloat(form.loyaltyMultiplier),
        salesTarget: form.salesTarget ? parseFloat(form.salesTarget) : undefined,
      };
      return isEdit
        ? crmApi.updateSeason(season!.id, { ...payload, version: season!.version })
        : crmApi.createSeason(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Season updated' : 'Season created');
      qc.invalidateQueries({ queryKey: ['crm-seasons'] });
      qc.invalidateQueries({ queryKey: ['crm-active-season'] });
      navigate(LIST_PATH);
    },
    onError: () =>
      toast.error(
        isEdit
          ? 'Failed to update season (possible conflict — refresh and try again)'
          : 'Failed to create season'
      ),
  });

  const f = <K extends keyof typeof form>(key: K, val: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const today = new Date();
  const seasonStart = form.startDate ? new Date(form.startDate) : null;
  const seasonEnd = form.endDate ? new Date(form.endDate) : null;
  const daysTotal =
    seasonStart && seasonEnd
      ? Math.ceil((seasonEnd.getTime() - seasonStart.getTime()) / 86400000)
      : 0;
  const daysLeft = seasonEnd ? Math.ceil((seasonEnd.getTime() - today.getTime()) / 86400000) : 0;
  const pct =
    daysTotal > 0
      ? Math.max(
          0,
          Math.min(100, Math.round(((daysTotal - Math.max(0, daysLeft)) / daysTotal) * 100))
        )
      : 0;

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Season" backTo={LIST_PATH} />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Season' : 'New Season'}
        subtitle="Manage business seasons, stock multipliers, and loyalty bonuses"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Season Details" columns={2}>
        <Input label="Season Name" value={form.name} onChange={(e) => f('name', e.target.value)} />
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">Season Type</label>
          <select
            value={form.seasonType}
            onChange={(e) => f('seasonType', e.target.value as Season['seasonType'])}
            className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
          >
            {SEASON_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Start Date"
          type="date"
          value={form.startDate}
          onChange={(e) => f('startDate', e.target.value)}
        />
        <Input
          label="End Date"
          type="date"
          value={form.endDate}
          onChange={(e) => f('endDate', e.target.value)}
        />
        <Input
          label="Stock Multiplier"
          type="number"
          step="0.1"
          value={form.stockMultiplier}
          onChange={(e) => f('stockMultiplier', e.target.value)}
        />
        <Input
          label="Loyalty Multiplier"
          type="number"
          step="0.1"
          value={form.loyaltyMultiplier}
          onChange={(e) => f('loyaltyMultiplier', e.target.value)}
        />
        <Input
          label="Sales Target (optional)"
          type="number"
          step="1000"
          value={form.salesTarget}
          onChange={(e) => f('salesTarget', e.target.value)}
        />
      </ERPFormSection>

      {daysTotal > 0 && (
        <div className="mt-4 bg-surface-card border border-default rounded-xl p-4">
          <div className="flex justify-between text-xs text-secondary mb-1">
            <span>Season progress</span>
            <span>
              {pct}% — {Math.max(0, daysLeft)} days left
            </span>
          </div>
          <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.name || !form.startDate || !form.endDate}
        >
          {mutation.isPending
            ? isEdit
              ? 'Saving…'
              : 'Creating…'
            : isEdit
              ? 'Save Changes'
              : 'Create Season'}
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
