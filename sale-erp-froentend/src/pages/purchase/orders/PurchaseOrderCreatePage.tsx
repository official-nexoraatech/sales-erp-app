import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { purchaseApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { PurchaseOrderForm } from './PurchaseOrderForm';

export const PurchaseOrderCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: purchaseApi.create,
    onSuccess: () => {
      toast.success('Purchase order created successfully');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      navigate('/purchase/orders');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create purchase order'),
  });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Order List &gt; Create Purchase Order</div><PurchaseOrderForm submitText="Submit" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/purchase/orders')} /></div>;
};
