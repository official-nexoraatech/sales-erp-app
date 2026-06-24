import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { paymentOutApi, purchaseApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import type { PurchaseSubmitPayload } from '../bills/PurchaseForm';
import { PurchaseOrderForm } from './PurchaseOrderForm';

export const PurchaseOrderCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async (payload: PurchaseSubmitPayload) => {
      const { paymentAmount = 0, paymentMethodId = 0, paymentNote = '', ...purchasePayload } = payload;
      const response = await purchaseApi.create(purchasePayload);
      if (paymentAmount > 0 && paymentMethodId && response.data?.purchaseId) {
        await paymentOutApi.create({
          supplierId: purchasePayload.supplierId,
          paymentDate: purchasePayload.purchaseDate,
          paymentMethodId,
          referenceNo: purchasePayload.referenceNo,
          amount: paymentAmount,
          notes: paymentNote,
          purchaseIds: [response.data.purchaseId],
        });
      }
      return response;
    },
    onSuccess: () => {
      toast.success('Purchase order created successfully');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      navigate('/purchase/orders');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create purchase order'),
  });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Order List &gt; Create Purchase Order</div><PurchaseOrderForm submitText="Submit" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/purchase/orders')} /></div>;
};
