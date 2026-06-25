import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { paymentOutApi, purchaseApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { PurchaseForm, type PurchaseSubmitPayload } from './PurchaseForm';

export const PurchaseCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async (payload: PurchaseSubmitPayload) => {
      const { payments = [], ...purchasePayload } = payload;
      const response = await purchaseApi.create(purchasePayload);
      for (const payment of payments) {
        if (!response.data?.purchaseId) break;
        await paymentOutApi.create({
          supplierId: purchasePayload.supplierId,
          paymentDate: purchasePayload.purchaseDate,
          paymentMethodId: payment.paymentMethodId,
          referenceNo: purchasePayload.referenceNo,
          amount: payment.amount,
          notes: payment.paymentNote,
          purchaseIds: [response.data.purchaseId],
        });
      }
      return response;
    },
    onSuccess: () => {
      toast.success('Purchase created successfully');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      navigate('/purchase/bills');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create purchase'),
  });

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Bills &gt; Create Purchase</div>
      <PurchaseForm submitText="Submit" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/purchase/bills')} />
    </div>
  );
};
