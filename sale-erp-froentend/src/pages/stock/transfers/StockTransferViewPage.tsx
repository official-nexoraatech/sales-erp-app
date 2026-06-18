import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { stockTransferApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { formatDate } from '../../../utils/formatDate';

export const StockTransferViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const transfer = useQuery({ queryKey: ['stock-transfer', id], queryFn: () => stockTransferApi.getById(id), enabled: id > 0 });
  if (transfer.isLoading) return <Loader />;
  const data = transfer.data?.data;
  return (
    <div className="space-y-6">
      <PageHeader title={`Stock Transfer ${data?.transferNo || data?.transferCode || ''}`} actions={<Button variant="secondary" onClick={() => navigate('/stock/transfers')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3"><div><p className="text-sm text-gray-500">Date</p><p className="font-semibold">{data?.transferDate ? formatDate(data.transferDate) : 'N/A'}</p></div><div><p className="text-sm text-gray-500">From Warehouse</p><p className="font-semibold">{data?.fromWarehouse?.name || data?.fromWarehouseName || 'N/A'}</p></div><div><p className="text-sm text-gray-500">To Warehouse</p><p className="font-semibold">{data?.toWarehouse?.name || data?.toWarehouseName || 'N/A'}</p></div><div className="md:col-span-3"><p className="text-sm text-gray-500">Notes</p><p className="font-semibold">{data?.notes || 'N/A'}</p></div></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Item', 'Quantity', 'Unit'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{data?.items?.map((item) => <tr key={item.itemId}><td className="border p-3">{item.itemName}</td><td className="border p-3">{item.quantity}</td><td className="border p-3">{item.unitName || 'None'}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
};
