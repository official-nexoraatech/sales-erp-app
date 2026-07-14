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
      const { payments = [], loadedPurchaseId, requestCancel, statusOverride, ...purchasePayload } = payload;
      if (requestCancel && loadedPurchaseId) {
        return purchaseApi.cancel(loadedPurchaseId);
      }
      const response = loadedPurchaseId
        ? await purchaseApi.update(loadedPurchaseId, purchasePayload)
        : await purchaseApi.create(purchasePayload);
      const purchaseId = loadedPurchaseId || response.data?.purchaseId;
      for (const payment of payments) {
        if (!purchaseId) break;
        await paymentOutApi.create({
          supplierId: purchasePayload.supplierId,
          paymentDate: purchasePayload.purchaseDate,
          paymentMethodId: payment.paymentMethodId,
          referenceNo: purchasePayload.referenceNo,
          amount: payment.amount,
          notes: payment.paymentNote,
          purchaseIds: [purchaseId],
        });
      }
      if (statusOverride && purchaseId) {
        await purchaseApi.updateStatus(purchaseId, statusOverride);
      }
      return response;
    },
    onSuccess: (_response, variables) => {
      toast.success(variables.requestCancel ? 'Purchase order cancelled' : 'Purchase order saved successfully');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      navigate('/purchase/orders');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to save purchase order'),
  });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Order List &gt; Create Purchase Order</div><PurchaseOrderForm submitText="Submit" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/purchase/orders')} /></div>;
};
