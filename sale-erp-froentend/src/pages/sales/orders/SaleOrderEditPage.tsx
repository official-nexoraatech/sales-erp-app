import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { salesApi } from '../../../api/endpoints';
import { Loader } from '../../../components/ui/Loader';
import { SaleOrderForm } from './SaleOrderForm';

export const SaleOrderEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const sale = useQuery({ queryKey: ['sale-order', id], queryFn: () => salesApi.getById(id), enabled: id > 0 });
  const mutation = useMutation({
    mutationFn: (payload: any) => salesApi.update(id, payload),
    onSuccess: () => {
      toast.success('Sale order updated successfully');
      navigate('/sales/orders');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update sale order'),
  });

  if (sale.isLoading) return <Loader />;

  const detail = sale.data?.data;
  const initial = detail ? {
    customerId: detail.customer.id,
    invoiceDate: detail.invoiceDate,
    warehouseId: detail.warehouse.id,
    stateId: 0,
    salesPersonId: 0,
    notes: detail.notes || '',
    items: [],
    lines: detail.items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      batchId: item.batchId,
      quantity: item.qty,
      unitPrice: item.unitPrice,
      discountPercent: 0,
      taxPercent: 0,
    })),
  } : undefined;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Sale &gt; Sale Order List &gt; Edit Sale Order</div>
      <SaleOrderForm initial={initial} submitText="Update" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/sales/orders')} />
    </div>
  );
};
