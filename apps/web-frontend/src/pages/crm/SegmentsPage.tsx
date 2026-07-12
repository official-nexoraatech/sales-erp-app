import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { crmApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPCardSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Segment {
  id: number;
  name: string;
  code: string;
  isSystem: boolean;
  description?: string;
  _count?: number;
}

interface HealthCounts {
  champion: number;
  loyal: number;
  atRisk: number;
  lost: number;
  unscored: number;
}

const PREBUILT_CODES = [
  { code: 'no-purchase-60-days', label: 'No Purchase (60+ days)' },
  { code: 'gold-tier', label: 'Gold Tier Members' },
  { code: 'high-value', label: 'High Value Customers' },
  { code: 'overdue-30', label: 'Overdue 30+ Days' },
  { code: 'birthdays-this-month', label: 'Birthdays This Month' },
  { code: 'new-customers-this-month', label: 'New Customers This Month' },
];

const SEGMENT_FIELDS = [
  'customerType',
  'status',
  'creditLimit',
  'loyaltyPoints',
  'openingBalance',
  'healthSegment',
  'healthScore',
];
const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'];

export default function SegmentsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.CRM_SEGMENT_CREATE);

  const [createOpen, setCreateOpen] = useState(false);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    field: 'status',
    operator: 'eq',
    value: '',
  });

  const { data: segData, isLoading: segmentsLoading } = useQuery({
    queryKey: ['crm-segments'],
    queryFn: () => crmApi.listSegments(),
  });
  const segments: Segment[] = (segData as { content?: Segment[] })?.content ?? [];

  const { data: healthData } = useQuery({
    queryKey: ['crm-health'],
    queryFn: () => crmApi.healthSegments(),
  });
  const health = healthData as HealthCounts | undefined;

  const previewMut = useMutation({
    mutationFn: (code: string) =>
      crmApi.previewSegment(
        PREBUILT_CODES.some((p) => p.code === code)
          ? { segmentCode: code }
          : {
              rules: [{ field: form.field, operator: form.operator, value: form.value }],
              logic: 'AND',
            }
      ),
    onSuccess: (res, code) => {
      const d = res as Record<string, unknown>;
      setPreviewCount((d?.matchingCount as number) ?? 0);
      setPreviewCode(code);
    },
  });

  const createMut = useMutation({
    mutationFn: () =>
      crmApi.createSegment({
        name: form.name,
        description: form.description,
        rules: [{ field: form.field, operator: form.operator, value: form.value }],
        logic: 'AND',
      }),
    onSuccess: () => {
      toast.success('Segment created');
      qc.invalidateQueries({ queryKey: ['crm-segments'] });
      setCreateOpen(false);
      setForm({ name: '', description: '', field: 'status', operator: 'eq', value: '' });
    },
    onError: () => toast.error('Failed to create segment'),
  });

  const exportSegment = (idOrCode: string | number) => {
    const base = (window as unknown as { ENV_SALES_URL?: string }).ENV_SALES_URL ?? '/api/sales';
    window.open(`${base}/crm/segments/${idOrCode}/export`, '_blank');
  };

  const segBadgeColor = (code: string): 'green' | 'yellow' | 'red' | 'gray' => {
    if (code === 'gold-tier' || code === 'high-value') return 'green';
    if (code === 'no-purchase-60-days' || code === 'overdue-30') return 'red';
    return 'gray';
  };

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Customer Segments"
        subtitle="Pre-built and custom segments for targeted campaigns"
        actions={
          canCreate ? <Button onClick={() => setCreateOpen(true)}>+ New Segment</Button> : undefined
        }
      />

      {/* Health Score Summary */}
      {health && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            {
              label: 'Champion',
              count: health.champion,
              color: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
            },
            {
              label: 'Loyal',
              count: health.loyal,
              color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
            },
            {
              label: 'At Risk',
              count: health.atRisk,
              color: 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20',
            },
            {
              label: 'Lost',
              count: health.lost,
              color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
            },
            {
              label: 'Unscored',
              count: health.unscored,
              color: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800',
            },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl p-4 text-center ${s.color}`}>
              <p className="text-2xl font-bold">{s.count}</p>
              <p className="text-xs font-medium uppercase tracking-wide mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pre-built Segments */}
      <div className="bg-surface-card rounded-xl border border-default mb-6">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">Pre-built Segments</h2>
        </div>
        <div className="divide-y divide-default">
          {PREBUILT_CODES.map((p) => (
            <div
              key={p.code}
              className="flex items-center justify-between px-5 py-3 flex-wrap gap-2"
            >
              <div className="flex items-center gap-3">
                <Badge label="SYSTEM" color={segBadgeColor(p.code)} />
                <span className="text-sm text-primary">{p.label}</span>
                <span className="text-xs text-secondary font-mono">{p.code}</span>
              </div>
              <div className="flex items-center gap-2">
                {previewCode === p.code && previewCount !== null && (
                  <span className="text-xs text-secondary">{previewCount} customers</span>
                )}
                <Button variant="ghost" size="sm" onClick={() => previewMut.mutate(p.code)}>
                  Preview
                </Button>
                <Button variant="secondary" size="sm" onClick={() => exportSegment(p.code)}>
                  Export CSV
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom Saved Segments */}
      <div className="bg-surface-card rounded-xl border border-default">
        <div className="px-5 py-4 border-b border-default">
          <h2 className="text-sm font-semibold text-primary">Saved Segments</h2>
        </div>
        {segmentsLoading ? (
          <div className="p-4">
            <ERPCardSkeleton lines={2} />
          </div>
        ) : segments.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No custom segments yet"
            description="Custom filter-based segments you create will appear here."
            {...(canCreate
              ? { action: { label: '+ New Segment', onClick: () => setCreateOpen(true) } }
              : {})}
          />
        ) : (
          <div className="divide-y divide-default">
            {segments
              .filter((s) => !s.isSystem)
              .map((seg) => (
                <div
                  key={seg.id}
                  className="flex items-center justify-between px-5 py-3 flex-wrap gap-2"
                >
                  <div>
                    <p className="text-sm font-medium text-primary">{seg.name}</p>
                    {seg.description && <p className="text-xs text-secondary">{seg.description}</p>}
                    <span className="text-xs font-mono text-secondary">{seg.code}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => exportSegment(seg.id)}>
                      Export CSV
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Create Segment Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Custom Segment">
        <div className="space-y-4">
          <Input
            label="Segment Name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Description (optional)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div>
            <p className="text-xs font-semibold text-secondary mb-2 uppercase tracking-wide">
              Filter Rule
            </p>
            <div className="flex gap-2 flex-wrap">
              <select
                value={form.field}
                onChange={(e) => setForm((f) => ({ ...f, field: e.target.value }))}
                className="flex-1 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                {SEGMENT_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                value={form.operator}
                onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))}
                className="w-28 rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
              >
                {OPERATORS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <Input
                placeholder="Value"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.name || !form.value}
            >
              {createMut.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
