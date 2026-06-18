import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { stockAdjustmentApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { formatDate } from '../../../utils/formatDate';

export const StockAdjustmentViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const adjustment = useQuery({ queryKey: ['stock-adjustment', id], queryFn: () => stockAdjustmentApi.getById(id), enabled: id > 0 });
  if (adjustment.isLoading) return <Loader />;
  const data = adjustment.data?.data;
  return (
    <div className="space-y-6">
      <PageHeader title={`Stock Adjustment ${data?.adjustmentNo || data?.adjustmentCode || ''}`} actions={<Button variant="secondary" onClick={() => navigate('/stock/adjustments')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3"><div><p className="text-sm text-gray-500">Date</p><p className="font-semibold">{data?.adjustmentDate ? formatDate(data.adjustmentDate) : 'N/A'}</p></div><div><p className="text-sm text-gray-500">Warehouse</p><p className="font-semibold">{data?.warehouse?.name || data?.warehouseName || 'N/A'}</p></div><div className="md:col-span-3"><p className="text-sm text-gray-500">Reason</p><p className="font-semibold">{data?.reason || 'N/A'}</p></div></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Item', 'Current Qty', 'Actual Qty', 'Unit', 'Type'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{data?.items?.map((item) => <tr key={item.itemId}><td className="border p-3">{item.itemName}</td><td className="border p-3">{item.currentQty}</td><td className="border p-3">{item.actualQty}</td><td className="border p-3">{item.unitName || 'None'}</td><td className="border p-3">{item.actualQty - item.currentQty >= 0 ? 'Increase' : 'Decrease'}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
};
