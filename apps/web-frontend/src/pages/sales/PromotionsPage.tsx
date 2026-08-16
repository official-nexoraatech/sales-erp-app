import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { promotionApi } from '../../api/endpoints.js';
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

// Multi-vertical platform audit 2026-08-16, Phase 2 — multi-buy/BOGO pricing promotions.
interface Promotion {
  id: number;
  name: string;
  promotionType: 'BUY_X_GET_Y_FREE' | 'BUY_X_GET_Y_PERCENT_OFF';
  itemId: number | null;
  categoryId: number | null;
  buyQuantity: number;
  getQuantity: number;
  getDiscountPct: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  version: number;
}

const BLANK_FORM = {
  name: '',
  promotionType: 'BUY_X_GET_Y_FREE' as Promotion['promotionType'],
  itemId: '',
  buyQuantity: '2',
  getQuantity: '1',
  getDiscountPct: '100',
  startDate: '',
  endDate: '',
};

function describePromo(p: Promotion): string {
  const bundle = `Buy ${p.buyQuantity} Get ${p.getQuantity}`;
  return p.promotionType === 'BUY_X_GET_Y_FREE'
    ? `${bundle} Free`
    : `${bundle} at ${p.getDiscountPct}% off`;
}

export default function PromotionsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission(PERMISSIONS.PROMOTION_MANAGE);
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['pricing-promotions'],
    queryFn: () => promotionApi.list(),
  });
  const promotions: Promotion[] = (data as { content?: Promotion[] })?.content ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      promotionApi.create({
        name: form.name,
        promotionType: form.promotionType,
        itemId: Number(form.itemId),
        buyQuantity: Number(form.buyQuantity),
        getQuantity: Number(form.getQuantity),
        getDiscountPct: Number(form.getDiscountPct),
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
      }),
    onSuccess: () => {
      toast.success('Promotion created');
      setFormOpen(false);
      setForm(BLANK_FORM);
      void qc.invalidateQueries({ queryKey: ['pricing-promotions'] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create promotion');
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (p: Promotion) =>
      promotionApi.update(p.id, { version: p.version, isActive: !p.isActive }),
    onSuccess: () => {
      toast.success('Promotion updated');
      void qc.invalidateQueries({ queryKey: ['pricing-promotions'] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update promotion');
    },
  });

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Promotions"
        subtitle="Multi-buy and BOGO pricing deals — e.g. Buy 2 Get 1 Free"
        actions={
          canManage ? <Button onClick={() => setFormOpen(true)}>+ New Promotion</Button> : undefined
        }
      />

      <div className="bg-surface-card rounded-xl border border-default">
        {isLoading ? (
          <ERPTableSkeleton rows={4} cols={3} />
        ) : promotions.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No promotions configured yet"
            description="Create a multi-buy or BOGO deal, e.g. Buy 2 Get 1 Free on a specific item."
            {...(canManage
              ? { action: { label: '+ New Promotion', onClick: () => setFormOpen(true) } }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {promotions.map((p) => (
              <div key={p.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-primary">{p.name}</p>
                      {p.isActive ? (
                        <Badge label="ACTIVE" color="green" />
                      ) : (
                        <Badge label="INACTIVE" color="gray" />
                      )}
                      <Badge label={describePromo(p)} color="blue" />
                    </div>
                    <p className="text-xs text-secondary mt-0.5">
                      {formatDate(p.startDate)} – {formatDate(p.endDate)} · Item #
                      {p.itemId ?? p.categoryId}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toggleActiveMutation.mutate(p)}
                    >
                      {p.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="New Promotion">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <Input
            label="Promotion Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">Type</label>
            <select
              value={form.promotionType}
              onChange={(e) =>
                setForm({ ...form, promotionType: e.target.value as Promotion['promotionType'] })
              }
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
            >
              <option value="BUY_X_GET_Y_FREE">Buy X Get Y Free</option>
              <option value="BUY_X_GET_Y_PERCENT_OFF">Buy X Get Y at % off</option>
            </select>
          </div>
          <Input
            label="Item ID"
            type="number"
            value={form.itemId}
            onChange={(e) => setForm({ ...form, itemId: e.target.value })}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Buy Quantity"
              type="number"
              value={form.buyQuantity}
              onChange={(e) => setForm({ ...form, buyQuantity: e.target.value })}
              required
            />
            <Input
              label="Get Quantity"
              type="number"
              value={form.getQuantity}
              onChange={(e) => setForm({ ...form, getQuantity: e.target.value })}
              required
            />
          </div>
          {form.promotionType === 'BUY_X_GET_Y_PERCENT_OFF' && (
            <Input
              label="Discount on 'Get' units (%)"
              type="number"
              value={form.getDiscountPct}
              onChange={(e) => setForm({ ...form, getDiscountPct: e.target.value })}
              required
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start Date"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
            <Input
              label="End Date"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
