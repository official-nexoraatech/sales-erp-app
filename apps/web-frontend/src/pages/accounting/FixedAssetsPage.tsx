import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { fixedAssetApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPConfirmModal from '../../components/erp/ERPConfirmModal.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

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
  usefulLifeMonths: number;
  status: string;
}

const STATUS_COLORS: Record<string, 'green' | 'red' | 'gray'> = {
  ACTIVE: 'green',
  DISPOSED: 'gray',
};

export default function FixedAssetsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateAsset = hasPermission(PERMISSIONS.FIXED_ASSET_CREATE);
  const canRunDepreciation = hasPermission(PERMISSIONS.FIXED_ASSET_UPDATE);

  const now = new Date();
  const [runDepModalOpen, setRunDepModalOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn: () => fixedAssetApi.list(),
  });

  const assets: FixedAsset[] = (data as { content?: FixedAsset[] })?.content ?? [];
  const totalNetBookValue = assets.reduce((s, a) => s + Number(a.currentValue), 0);

  const columns: ERPColumnDef<FixedAsset>[] = [
    {
      key: 'assetCode',
      header: 'Code',
      mono: true,
      className: 'text-xs text-disabled',
      hideable: false,
    },
    { key: 'name', header: 'Asset Name', className: 'font-medium text-primary' },
    { key: 'category', header: 'Category', className: 'text-secondary' },
    { key: 'depreciationMethod', header: 'Method', className: 'text-secondary' },
    {
      key: 'purchaseDate',
      header: 'Purchase Date',
      className: 'text-secondary text-xs',
      render: (row) => formatDate(row.purchaseDate),
    },
    {
      key: 'purchaseCost',
      header: 'Cost',
      align: 'right',
      mono: true,
      render: (row) => formatCurrency(Number(row.purchaseCost)),
    },
    {
      key: 'currentValue',
      header: 'Net Book Value',
      align: 'right',
      mono: true,
      className: 'font-semibold text-primary',
      render: (row) => formatCurrency(Number(row.currentValue)),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge label={row.status} color={STATUS_COLORS[row.status] ?? 'gray'} />,
    },
  ];

  const runDepreciationMutation = useMutation({
    mutationFn: () => fixedAssetApi.runDepreciation({ periodMonth, periodYear }),
    onSuccess: (res) => {
      const { processed, errors } = (res as { processed: number; errors: number }) ?? {
        processed: 0,
        errors: 0,
      };
      toast.success(
        `Posted depreciation for ${processed} asset(s)${errors ? `, ${errors} error(s)` : ''}`
      );
      qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      setRunDepModalOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Fixed Asset Register"
        subtitle={`${assets.length} asset(s) · Net Book Value: ${formatCurrency(totalNetBookValue)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canRunDepreciation && (
              <Button variant="secondary" onClick={() => setRunDepModalOpen(true)}>
                Run Depreciation
              </Button>
            )}
            {canCreateAsset && (
              <Button variant="primary" onClick={() => navigate('/accounting/fixed-assets/new')}>
                + Add Asset
              </Button>
            )}
          </div>
        }
      />

      <ERPDataGrid
        columns={columns}
        data={assets}
        isLoading={isLoading}
        rowKey="id"
        onRowClick={(asset) => navigate(`/accounting/fixed-assets/${asset.id}`)}
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No fixed assets registered"
            description="Add assets like machinery, vehicles, and computers"
            {...(canCreateAsset
              ? {
                  action: {
                    label: 'Add First Asset',
                    onClick: () => navigate('/accounting/fixed-assets/new'),
                  },
                }
              : {})}
          />
        }
        footer={
          assets.length > 0 && (
            <>
              <td colSpan={6} className="px-4 py-3 text-primary">
                Total Net Book Value
              </td>
              <td className="px-4 py-3 text-right font-mono text-primary">
                {formatCurrency(totalNetBookValue)}
              </td>
              <td />
            </>
          )
        }
      />

      <ERPConfirmModal
        open={runDepModalOpen}
        onClose={() => setRunDepModalOpen(false)}
        onConfirm={() => runDepreciationMutation.mutate()}
        title="Run Monthly Depreciation"
        variant="warning"
        confirmLabel="Run Depreciation"
        isLoading={runDepreciationMutation.isPending}
        description={
          <div className="space-y-3 text-left">
            <p>Post depreciation journal entries for all active assets for the selected period.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label="Month"
                value={periodMonth}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
              <Select
                label="Year"
                value={periodYear}
                onChange={(e) => setPeriodYear(Number(e.target.value))}
              >
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        }
      />
    </div>
  );
}
