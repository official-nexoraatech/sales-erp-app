import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { salesApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { SaleForm } from './SaleForm';

export const SaleCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: salesApi.create,
    onSuccess: async () => {
      toast.success('Sale created successfully');
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
      navigate('/sales/invoices');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create sale'),
  });

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Sale &gt; Invoices &gt; Create Sale</div>
      <SaleForm
        submitText="Submit"
        loading={mutation.isPending}
        onSubmit={(payload) => mutation.mutate(payload)}
        onCancel={() => navigate('/sales/invoices')}
      />
    </div>
  );
};
