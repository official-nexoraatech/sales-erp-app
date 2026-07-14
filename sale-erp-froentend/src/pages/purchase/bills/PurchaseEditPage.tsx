import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { paymentOutApi, purchaseApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Loader } from '../../../components/ui/Loader';
import { PurchaseForm, type PurchaseSubmitPayload } from './PurchaseForm';

interface Props {
  mode?: 'bill' | 'order';
}

export const PurchaseEditPage: React.FC<Props> = ({ mode = 'bill' }) => {
  const navigate = useNavigate();
  const listPath = mode === 'order' ? '/purchase/orders' : '/purchase/bills';
  const id = Number(useParams<{ id: string }>().id);
  const purchase = useQuery({ queryKey: ['purchase', id], queryFn: () => purchaseApi.getById(id), enabled: id > 0 });
  const mutation = useMutation({
    mutationFn: async (payload: PurchaseSubmitPayload) => {
      const { payments = [], requestCancel, statusOverride, ...purchasePayload } = payload;
      if (requestCancel) {
        return purchaseApi.cancel(id);
      }
      const response = await purchaseApi.update(id, purchasePayload);
      for (const payment of payments) {
        await paymentOutApi.create({
          supplierId: purchasePayload.supplierId,
          paymentDate: purchasePayload.purchaseDate,
          paymentMethodId: payment.paymentMethodId,
          referenceNo: purchasePayload.referenceNo,
          amount: payment.amount,
          notes: payment.paymentNote,
          purchaseIds: [id],
        });
      }
      if (statusOverride) {
        await purchaseApi.updateStatus(id, statusOverride);
      }
      return response;
    },
    onSuccess: (_response, variables) => {
      toast.success(variables.requestCancel ? 'Purchase cancelled' : 'Purchase updated successfully');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', id] });
      navigate(listPath);
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update purchase'),
  });

  if (purchase.isLoading) return <Loader />;

  const detail = purchase.data?.data;
  const initial = detail ? {
    supplierId: detail.supplier.id,
    purchaseDate: detail.purchaseDate,
    referenceNo: detail.referenceNo || '',
    warehouseId: detail.warehouse.id,
    carrierId: detail.carrier?.id || 0,
    stateId: 0,
    notes: detail.notes || '',
    items: [],
    purchaseNo: detail.purchaseNo,
    status: detail.status,
    lines: detail.items.map((item) => ({
      itemId: item.itemId,
      itemName: item.itemName,
      batchNo: item.batchNo || '',
      manufacturingDate: item.manufacturingDate || new Date().toISOString().slice(0, 10),
      expiryDate: item.expiryDate || new Date().toISOString().slice(0, 10),
      quantity: item.qty || item.quantity || 1,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent || 0,
      taxPercent: item.taxPercent || 0,
    })),
  } : undefined;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Purchase &gt; {mode === 'order' ? 'Purchase Order List &gt; Purchase Order Details' : 'Purchase Bills &gt; Edit Purchase'}</div>
      <PurchaseForm mode={mode} initial={initial} submitText="Update" loading={mutation.isPending} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate(listPath)} />
    </div>
  );
};
