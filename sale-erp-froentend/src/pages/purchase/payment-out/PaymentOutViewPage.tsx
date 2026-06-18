import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { paymentOutApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';

export const PaymentOutViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({ queryKey: ['payment-out', id], queryFn: () => paymentOutApi.getById(id), enabled: id > 0 });

  if (isLoading) return <div className="p-10"><Loader /></div>;
  const payment = data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title={`Payment Out ${payment?.paymentNo || ''}`} actions={<Button variant="secondary" onClick={() => navigate('/purchase/payment-out')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div><p className="text-sm text-gray-500">Payment Type</p><p className="font-semibold">{payment?.paymentType || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Supplier</p><p className="font-semibold">{payment?.party?.name || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Payment Method</p><p className="font-semibold">{payment?.paymentMethod?.name || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Payment Date</p><p className="font-semibold">{payment?.paymentDate ? formatDate(payment.paymentDate) : 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Reference No.</p><p className="font-semibold">{payment?.referenceNo || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Amount</p><p className="font-semibold">{formatCurrency(payment?.amount || 0)}</p></div>
          <div className="md:col-span-2"><p className="text-sm text-gray-500">Purchase IDs</p><p className="font-semibold">{payment?.purchaseIds?.join(', ') || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-sm text-gray-500">Notes</p><p className="font-semibold">{payment?.notes || 'N/A'}</p></div>
        </div>
      </Card>
    </div>
  );
};
