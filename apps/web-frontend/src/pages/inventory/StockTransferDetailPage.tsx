import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { stockTransferApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';

export default function StockTransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfer', id],
    queryFn: () => stockTransferApi.getById(Number(id)),
    enabled: !!id,
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!data) return <ERPEmptyState type="no-data" title="Stock transfer not found" />;

  const t = data as Record<string, unknown>;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={String(t.transferNumber ?? 'Stock Transfer')}
        entityType="Stock Transfer"
        entityNumber={String(t.transferNumber ?? '')}
        status={String(t.status ?? '')}
        backTo="/inventory/transfers"
      />
      <div className="bg-surface-card border border-default rounded-xl p-6 text-secondary text-sm">
        Stock transfer detail view — From: {String(t.fromWarehouseId ?? '–')} → To: {String(t.toWarehouseId ?? '–')} | Status: {String(t.status ?? '–')}
      </div>
    </div>
  );
}
