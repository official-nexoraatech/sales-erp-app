import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { salesApi } from '../../../api/endpoints';
import { SaleOrderForm } from './SaleOrderForm';

export const SaleOrderCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: salesApi.create,
    onSuccess: () => {
      toast.success('Sale order created successfully');
      navigate('/sales/orders');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create sale order'),
  });

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Sale &gt; Sale Order List &gt; Create Sale Order</div>
      <SaleOrderForm submitText="Submit" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/sales/orders')} />
    </div>
  );
};
