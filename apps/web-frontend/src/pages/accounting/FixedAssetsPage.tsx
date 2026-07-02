import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fixedAssetApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import { formatCurrency, formatDate } from '../../lib/format.js';

interface FixedAsset {
  id: number;
  assetCode: string;
  assetName: string;
  assetCategory: string;
  purchaseDate: string;
  purchaseCost: string;
  currentValue: string;
  salvageValue: string;
  depreciationMethod: string;
  usefulLifeMonths: number;
  status: string;
  location?: string;
}

const STATUS_COLORS: Record<string, 'green' | 'red' | 'gray'> = {
  ACTIVE: 'green',
  DISPOSED: 'gray',
  IMPAIRED: 'red',
};

export default function FixedAssetsPage() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['fixed-assets'],
    queryFn: () => fixedAssetApi.list(),
  });

  const assets: FixedAsset[] = (data as { data?: { content?: FixedAsset[] } })?.data?.content ?? [];
  const totalNetBookValue = assets.reduce((s, a) => s + Number(a.currentValue), 0);

  return (
    <div className="space-y-6">
      <ERPPageHeader
        variant="list"
        title="Fixed Asset Register"
        subtitle={`${assets.length} asset(s) · Net Book Value: ${formatCurrency(totalNetBookValue)}`}
        actions={
          <Button variant="primary" onClick={() => navigate('/accounting/fixed-assets/new')}>
            + Add Asset
          </Button>
        }
      />

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {isLoading ? (
          <ERPTableSkeleton rows={6} />
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="text-4xl mb-3">🏗️</div>
            <p className="text-primary font-medium">No fixed assets registered</p>
            <p className="text-secondary text-sm mt-1">Add assets like machinery, vehicles, and computers</p>
            <Button variant="primary" className="mt-4" onClick={() => navigate('/accounting/fixed-assets/new')}>Add First Asset</Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-secondary">Code</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Asset Name</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Category</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Method</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Purchase Date</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Cost</th>
                <th className="px-4 py-3 text-right font-medium text-secondary">Net Book Value</th>
                <th className="px-4 py-3 text-left font-medium text-secondary">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {assets.map((asset) => (
                <tr
                  key={asset.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer"
                  onClick={() => navigate(`/accounting/fixed-assets/${asset.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{asset.assetCode}</td>
                  <td className="px-4 py-3 font-medium text-primary">{asset.assetName}</td>
                  <td className="px-4 py-3 text-secondary">{asset.assetCategory}</td>
                  <td className="px-4 py-3 text-secondary">{asset.depreciationMethod}</td>
                  <td className="px-4 py-3 text-secondary text-xs">{formatDate(asset.purchaseDate)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(Number(asset.purchaseCost))}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-primary">{formatCurrency(Number(asset.currentValue))}</td>
                  <td className="px-4 py-3">
                    <Badge label={asset.status} color={STATUS_COLORS[asset.status] ?? 'gray'} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 dark:bg-gray-900/40 border-t border-gray-200 dark:border-gray-700">
              <tr>
                <td colSpan={6} className="px-4 py-3 font-semibold text-primary text-sm">Total Net Book Value</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-primary">{formatCurrency(totalNetBookValue)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
