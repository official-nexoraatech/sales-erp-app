import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
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

const SEASON_TYPES = ['FESTIVAL_SEASON', 'WEDDING_SEASON', 'SUMMER_COLLECTION', 'YEAR_END_SALE'] as const;

const BLANK_FORM = {
  name: '',
  seasonType: 'FESTIVAL_SEASON' as Season['seasonType'],
  startDate: '',
  endDate: '',
  stockMultiplier: '1.5',
  loyaltyMultiplier: '2.0',
  salesTarget: '',
};

export default function SeasonsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.CRM_SEASON_MANAGE);

  const [createOpen, setCreateOpen] = useState(false);
  const [editSeason, setEditSeason] = useState<Season | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });

  const { data, isLoading } = useQuery({ queryKey: ['crm-seasons'], queryFn: () => crmApi.listSeasons() });
  const seasons: Season[] = (data as { content?: Season[] })?.content ?? [];

  const { data: activeData } = useQuery({ queryKey: ['crm-active-season'], queryFn: () => crmApi.activeSeason() });
  const active = (activeData as Season | null | undefined);

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createSeason({
        name: form.name,
        seasonType: form.seasonType,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        stockMultiplier: parseFloat(form.stockMultiplier),
        loyaltyMultiplier: parseFloat(form.loyaltyMultiplier),
        salesTarget: form.salesTarget ? parseFloat(form.salesTarget) : undefined,
      }),
    onSuccess: () => {
      toast.success('Season created');
      qc.invalidateQueries({ queryKey: ['crm-seasons'] });
      qc.invalidateQueries({ queryKey: ['crm-active-season'] });
      setCreateOpen(false);
      setForm({ ...BLANK_FORM });
    },
    onError: () => toast.error('Failed to create season'),
  });

  const updateMut = useMutation({
    mutationFn: () =>
      crmApi.updateSeason(editSeason!.id, {
        name: form.name,
        seasonType: form.seasonType,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        stockMultiplier: parseFloat(form.stockMultiplier),
        loyaltyMultiplier: parseFloat(form.loyaltyMultiplier),
        salesTarget: form.salesTarget ? parseFloat(form.salesTarget) : undefined,
        version: editSeason!.version,
      }),
    onSuccess: () => {
      toast.success('Season updated');
      qc.invalidateQueries({ queryKey: ['crm-seasons'] });
      qc.invalidateQueries({ queryKey: ['crm-active-season'] });
      setEditSeason(null);
    },
    onError: () => toast.error('Failed to update season (possible conflict — refresh and try again)'),
  });

  function openEdit(s: Season) {
    setEditSeason(s);
    setForm({
      name: s.name,
      seasonType: s.seasonType,
      startDate: s.startDate.slice(0, 10),
      endDate: s.endDate.slice(0, 10),
      stockMultiplier: String(s.stockMultiplier),
      loyaltyMultiplier: String(s.loyaltyMultiplier),
      salesTarget: s.salesTarget != null ? String(s.salesTarget) : '',
    });
  }

  function SeasonForm() {
    const f = <K extends keyof typeof form>(key: K, val: typeof form[K]) =>
      setForm((prev) => ({ ...prev, [key]: val }));

    const today = new Date();
    const seasonStart = form.startDate ? new Date(form.startDate) : null;
    const seasonEnd = form.endDate ? new Date(form.endDate) : null;
    const daysTotal = seasonStart && seasonEnd ? Math.ceil((seasonEnd.getTime() - seasonStart.getTime()) / 86400000) : 0;
    const daysLeft = seasonEnd ? Math.ceil((seasonEnd.getTime() - today.getTime()) / 86400000) : 0;
    const pct = daysTotal > 0 ? Math.max(0, Math.min(100, Math.round(((daysTotal - Math.max(0, daysLeft)) / daysTotal) * 100))) : 0;

    return (
      <div className="space-y-4">
        <Input label="Season Name" value={form.name} onChange={(e) => f('name', e.target.value)} />
        <div>
          <label className="block text-xs font-medium text-secondary mb-1.5">Season Type</label>
          <select
            value={form.seasonType}
            onChange={(e) => f('seasonType', e.target.value as Season['seasonType'])}
            className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
          >
            {SEASON_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start Date" type="date" value={form.startDate} onChange={(e) => f('startDate', e.target.value)} />
          <Input label="End Date" type="date" value={form.endDate} onChange={(e) => f('endDate', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Stock Multiplier" type="number" step="0.1" value={form.stockMultiplier} onChange={(e) => f('stockMultiplier', e.target.value)} />
          <Input label="Loyalty Multiplier" type="number" step="0.1" value={form.loyaltyMultiplier} onChange={(e) => f('loyaltyMultiplier', e.target.value)} />
        </div>
        <Input label="Sales Target (optional)" type="number" step="1000" value={form.salesTarget} onChange={(e) => f('salesTarget', e.target.value)} />
        {daysTotal > 0 && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-secondary mb-1">
              <span>Season progress</span>
              <span>{pct}% — {Math.max(0, daysLeft)} days left</span>
            </div>
            <div className="h-2 bg-surface-raised rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Festival Season Planner"
        subtitle="Manage business seasons, stock multipliers, and loyalty bonuses"
        actions={
          canManage ? (
            <Button onClick={() => { setForm({ ...BLANK_FORM }); setCreateOpen(true); }}>+ New Season</Button>
          ) : undefined
        }
      />

      {/* Active season banner */}
      {active && (
        <div className="mb-6 bg-primary-subtle border border-primary/20 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-brand">Active Season: {active.name}</p>
            <p className="text-xs text-secondary mt-0.5">
              {formatDate(active.startDate)} – {formatDate(active.endDate)} ·
              {' '}{active.stockMultiplier}× stock · {active.loyaltyMultiplier}× loyalty
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
            {...(canManage ? { action: { label: '+ New Season', onClick: () => { setForm({ ...BLANK_FORM }); setCreateOpen(true); } } } : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {seasons.map((s) => {
              const today = new Date();
              const start = new Date(s.startDate);
              const end = new Date(s.endDate);
              const daysTotal = Math.ceil((end.getTime() - start.getTime()) / 86400000);
              const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86400000);
              const pct = daysTotal > 0 ? Math.max(0, Math.min(100, Math.round(((daysTotal - Math.max(0, daysLeft)) / daysTotal) * 100))) : 0;
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
                        {formatDate(s.startDate)} – {formatDate(s.endDate)} ·
                        {' '}{s.stockMultiplier}× stock · {s.loyaltyMultiplier}× loyalty
                        {s.salesTarget ? ` · Target ₹${s.salesTarget.toLocaleString()}` : ''}
                      </p>
                      <div className="mt-2 max-w-xs">
                        <div className="flex justify-between text-xs text-secondary mb-0.5">
                          <span>Progress</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                    {canManage && (
                      <Button variant="secondary" size="sm" onClick={() => openEdit(s)}>Edit</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Season">
        <div className="space-y-1">
          <SeasonForm />
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.name || !form.startDate || !form.endDate}>
              {createMut.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editSeason} onClose={() => setEditSeason(null)} title="Edit Season">
        <div className="space-y-1">
          <SeasonForm />
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="ghost" onClick={() => setEditSeason(null)}>Cancel</Button>
            <Button onClick={() => updateMut.mutate()} disabled={updateMut.isPending || !form.name || !form.startDate || !form.endDate}>
              {updateMut.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
