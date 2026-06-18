import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { itemApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';

export const ItemStockPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const stock = useQuery({ queryKey: ['item-stock', id], queryFn: () => itemApi.getStock(id), enabled: id > 0 });
  if (stock.isLoading) return <Loader />;
  const data = stock.data?.data;
  return (
    <div className="space-y-6">
      <PageHeader title={`Item Stock ${data?.itemName || ''}`} actions={<Button variant="secondary" onClick={() => navigate('/items')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div><p className="text-sm text-gray-500">Warehouse</p><p className="font-semibold">{data?.warehouseName || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Available Quantity</p><p className="font-semibold">{data?.availableQty ?? data?.quantity ?? 0}</p></div>
          <div><p className="text-sm text-gray-500">Minimum Stock</p><p className="font-semibold">{data?.minimumStock || 0}</p></div>
          <div><p className="text-sm text-gray-500">Batch No.</p><p className="font-semibold">{data?.batchNo || 'N/A'}</p></div>
        </div>
      </Card>
    </div>
  );
};
