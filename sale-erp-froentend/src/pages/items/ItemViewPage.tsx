import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { itemApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';
import { formatCurrency } from '../../utils/formatCurrency';

export const ItemViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const item = useQuery({ queryKey: ['item', id], queryFn: () => itemApi.getById(id), enabled: id > 0 });
  if (item.isLoading) return <Loader />;
  const data = item.data?.data;
  return (
    <div className="space-y-6">
      <PageHeader title={data?.itemName || 'Item'} actions={<Button variant="secondary" onClick={() => navigate('/items')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div><p className="text-sm text-gray-500">Item Code</p><p className="font-semibold">{data?.itemCode || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">SKU</p><p className="font-semibold">{data?.sku || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">HSN</p><p className="font-semibold">{data?.hsnCode || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Brand</p><p className="font-semibold">{data?.brandName || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Category</p><p className="font-semibold">{data?.categoryName || 'General'}</p></div>
          <div><p className="text-sm text-gray-500">Sale Price</p><p className="font-semibold">{formatCurrency(data?.salePrice || 0)}</p></div>
          <div><p className="text-sm text-gray-500">Purchase Price</p><p className="font-semibold">{formatCurrency(data?.purchasePrice || 0)}</p></div>
          <div><p className="text-sm text-gray-500">Quantity</p><p className="font-semibold">{data?.availableQty || 0}</p></div>
          <div><p className="text-sm text-gray-500">Status</p><p className="font-semibold">{data?.status ? 'Active' : 'Inactive'}</p></div>
          <div className="md:col-span-3"><p className="text-sm text-gray-500">Description</p><p className="font-semibold">{data?.description || 'N/A'}</p></div>
        </div>
      </Card>
    </div>
  );
};
