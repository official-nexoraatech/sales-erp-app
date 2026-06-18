import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { purchaseReturnApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';

export const PurchaseReturnViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const detail = useQuery({ queryKey: ['purchase-return', id], queryFn: () => purchaseReturnApi.getById(id), enabled: id > 0 });
  if (detail.isLoading) return <Loader />;
  const data = detail.data?.data;
  if (!data) return <div className="rounded bg-white p-6 shadow">Purchase return not found.</div>;
  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Return/Dr.Note &gt; View</div>
      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-5 flex items-center justify-between"><h1 className="text-xl font-semibold">Purchase Return {data.returnNo || `PR/${data.returnId}`}</h1><Button variant="secondary" onClick={() => navigate('/purchase/returns')}>Close</Button></div>
        <div className="grid gap-4 text-sm md:grid-cols-3"><p><b>Supplier:</b> {data.supplier.name}</p><p><b>Date:</b> {formatDate(data.returnDate)}</p><p><b>Total:</b> {formatCurrency(data.totalAmount || 0)}</p><p className="md:col-span-3"><b>Reason:</b> {data.reason || 'N/A'}</p></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr>{['Item', 'Batch ID', 'Qty', 'Rate', 'Total'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{data.items.map((item) => <tr key={`${item.itemId}-${item.batchId}`}><td className="border p-3">{item.itemName}</td><td className="border p-3">{item.batchId || 0}</td><td className="border p-3">{item.quantity}</td><td className="border p-3">{formatCurrency(item.rate)}</td><td className="border p-3">{formatCurrency(item.totalAmount || item.quantity * item.rate)}</td></tr>)}</tbody></table></div>
      </div>
    </div>
  );
};
