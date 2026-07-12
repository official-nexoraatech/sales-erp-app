import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { fixedAssetApi, accountApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPConfirmModal from '../../components/erp/ERPConfirmModal.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

const STATUS_COLORS: Record<string, 'green' | 'red' | 'gray'> = {
  ACTIVE: 'green',
  DISPOSED: 'gray',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface FixedAsset {
  id: number;
  assetCode: string;
  name: string;
  category: string;
  purchaseDate: string;
  purchaseCost: string;
  currentValue: string;
  salvageValue: string;
  depreciationMethod: string;
  wdvRate?: string | null;
  usefulLifeMonths: number;
  status: string;
}

interface ScheduleRow {
  id: number;
  periodMonth: number;
  periodYear: number;
  openingValue: string;
  depreciationAmount: string;
  closingValue: string;
}

interface AccountRow {
  id: number;
  name: string;
  isSystem?: boolean;
}

interface DisposeForm {
  disposalDate: string;
  disposalProceeds: number;
  gainLossAccountId: number;
}

export default function FixedAssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canUpdateAsset = hasPermission(PERMISSIONS.FIXED_ASSET_UPDATE);
  const canDisposeAsset = hasPermission(PERMISSIONS.FIXED_ASSET_DISPOSE);
  const [disposeModalOpen, setDisposeModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['fixed-assets', id],
    queryFn: () => fixedAssetApi.getById(Number(id)),
  });
  const asset = data as FixedAsset;

  const { data: scheduleData, isLoading: scheduleLoading } = useQuery({
    queryKey: ['fixed-assets', id, 'depreciation-schedule'],
    queryFn: () => fixedAssetApi.getDepreciationSchedule(Number(id)),
  });
  const schedule: ScheduleRow[] = (scheduleData as { content?: ScheduleRow[] })?.content ?? [];

  const { data: accData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountApi.list(),
    enabled: hasPermission(PERMISSIONS.ACCOUNT_VIEW),
  });
  const accounts = (((accData as Record<string, unknown>)?.content as AccountRow[]) ?? []).filter(
    (a) => !a.isSystem
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DisposeForm>();

  const disposeMutation = useMutation({
    mutationFn: (d: DisposeForm) =>
      fixedAssetApi.dispose(Number(id), {
        disposalDate: d.disposalDate,
        disposalProceeds: Number(d.disposalProceeds),
        gainLossAccountId: Number(d.gainLossAccountId),
      }),
    onSuccess: () => {
      toast.success('Asset disposed');
      qc.invalidateQueries({ queryKey: ['fixed-assets', id] });
      qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      setDisposeModalOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!asset) return <p className="text-sm text-danger">Asset not found.</p>;

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="detail"
        title={asset.name}
        entityType="Fixed Asset"
        entityNumber={asset.assetCode}
        status={asset.status}
        statusVariant={asset.status === 'ACTIVE' ? 'success' : 'default'}
        backTo="/accounting/fixed-assets"
        actions={
          <div className="flex flex-wrap gap-2">
            {canUpdateAsset && asset.status === 'ACTIVE' && (
              <Button
                variant="secondary"
                onClick={() => navigate(`/accounting/fixed-assets/${id}/edit`)}
              >
                Edit
              </Button>
            )}
            {canDisposeAsset && asset.status === 'ACTIVE' && (
              <Button variant="danger" onClick={() => setDisposeModalOpen(true)}>
                Dispose Asset
              </Button>
            )}
          </div>
        }
      />

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-secondary mb-4 uppercase tracking-wide">
          Summary
        </h2>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Asset Code', value: asset.assetCode },
            { label: 'Category', value: asset.category },
            { label: 'Purchase Date', value: formatDate(asset.purchaseDate) },
            { label: 'Purchase Cost', value: formatCurrency(Number(asset.purchaseCost)) },
            { label: 'Salvage Value', value: formatCurrency(Number(asset.salvageValue)) },
            { label: 'Net Book Value', value: formatCurrency(Number(asset.currentValue)) },
            { label: 'Method', value: asset.depreciationMethod },
            ...(asset.depreciationMethod === 'WDV' && asset.wdvRate
              ? [{ label: 'WDV Rate', value: `${asset.wdvRate}% p.a.` }]
              : []),
            {
              label: 'Status',
              value: <Badge label={asset.status} color={STATUS_COLORS[asset.status] ?? 'gray'} />,
            },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-secondary">{label}</dt>
              <dd className="text-sm font-medium text-primary mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
            Depreciation Schedule
          </h2>
        </div>
        {scheduleLoading ? (
          <div className="p-8 text-center text-sm text-secondary">Loading…</div>
        ) : schedule.length === 0 ? (
          <ERPEmptyState
            type="no-data"
            title="No depreciation posted yet"
            description="Depreciation entries will appear here once run from the Fixed Asset Register."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-secondary">Period</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Opening Value</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Depreciation</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Closing Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {schedule.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 text-secondary">
                    {MONTHS[row.periodMonth - 1]} {row.periodYear}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(Number(row.openingValue))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {formatCurrency(Number(row.depreciationAmount))}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-primary">
                    {formatCurrency(Number(row.closingValue))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ERPConfirmModal
        open={disposeModalOpen}
        onClose={() => setDisposeModalOpen(false)}
        onConfirm={handleSubmit((d) => disposeMutation.mutate(d))}
        title="Dispose Asset"
        variant="danger"
        confirmLabel="Dispose"
        isLoading={disposeMutation.isPending}
        description={
          <div className="space-y-3 text-left">
            <p>
              This will retire the asset and post a disposal journal entry. This cannot be undone.
            </p>
            <Input
              label="Disposal Date"
              type="date"
              required
              {...register('disposalDate', { required: 'Required' })}
              error={errors.disposalDate?.message}
            />
            <Input
              label="Disposal Proceeds (₹)"
              type="number"
              step="0.01"
              required
              {...register('disposalProceeds', { required: 'Required' })}
              error={errors.disposalProceeds?.message}
            />
            <Select
              label="Gain/Loss Account"
              required
              {...register('gainLossAccountId', { required: 'Required' })}
              error={errors.gainLossAccountId?.message}
            >
              <option value="">Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        }
      />
    </div>
  );
}
