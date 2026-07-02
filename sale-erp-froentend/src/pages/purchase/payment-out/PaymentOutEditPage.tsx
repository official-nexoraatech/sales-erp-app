import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { paymentMethodApi, paymentOutApi, purchaseApi, supplierApi } from '../../../api/endpoints';
import type { PaymentOutRequest } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { NumericInput } from '../../../components/ui/NumericInput';
import { formatCurrency } from '../../../utils/formatCurrency';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const PaymentOutEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const [supplierId, setSupplierId] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethodId, setPaymentMethodId] = useState(0);
  const [referenceNo, setReferenceNo] = useState('');
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [purchaseIds, setPurchaseIds] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  const payment = useQuery({ queryKey: ['payment-out', id], queryFn: () => paymentOutApi.getById(id), enabled: id > 0 });
  const suppliers = useQuery({ queryKey: ['payment-out-edit-suppliers'], queryFn: () => supplierApi.getAll({ page: 0, size: 100, search: '' }) });
  const purchases = useQuery({ queryKey: ['payment-out-edit-purchases'], queryFn: () => purchaseApi.getAll({ page: 0, size: 100, search: '' }) });
  const paymentMethods = useQuery({ queryKey: ['payment-out-edit-payment-methods'], queryFn: () => paymentMethodApi.getAll('') });
  const paymentMethodRows = (paymentMethods.data?.data?.content || [])
    .filter((method) => method.status === 'ACTIVE' || method.id === paymentMethodId);

  useEffect(() => {
    const data = payment.data?.data;
    if (!data || loaded) return;
    setSupplierId(data.party.id);
    setPaymentDate(data.paymentDate);
    setPaymentMethodId(data.paymentMethod.id);
    setReferenceNo(data.referenceNo || '');
    setAmount(data.amount);
    setNotes(data.notes || '');
    setPurchaseIds(data.purchaseIds || []);
    setLoaded(true);
  }, [payment.data, loaded]);

  const mutation = useMutation({
    mutationFn: (payload: PaymentOutRequest) => paymentOutApi.update(id, payload),
    onSuccess: () => {
      toast.success('Payment out updated successfully');
      navigate('/purchase/payment-out');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update payment out'),
  });

  const togglePurchase = (purchaseId: number) => {
    setPurchaseIds((current) => current.includes(purchaseId) ? current.filter((entry) => entry !== purchaseId) : [...current, purchaseId]);
  };

  const submit = () => {
    if (!supplierId || !paymentMethodId || amount <= 0) {
      toast.error('Select supplier, payment method, and valid amount.');
      return;
    }
    mutation.mutate({ supplierId, paymentDate, paymentMethodId, referenceNo, amount, notes, purchaseIds });
  };

  if (payment.isLoading || !loaded) return <div className="flex h-64 items-center justify-center"><Loader size="lg" /></div>;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Purchase &gt; Payment Out &gt; Edit Payment Out</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Payment Out Details</h1></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Supplier
            <select className={`${inputClass} mt-1`} value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}>
              <option value={0}>Select Supplier</option>
              {suppliers.data?.data?.content.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Date
            <input type="date" className={`${inputClass} mt-1`} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </label>
          <label className="text-sm text-gray-600">Payment Type
            <select className={`${inputClass} mt-1`} value={paymentMethodId} disabled={paymentMethods.isLoading || paymentMethods.isError} onChange={(event) => setPaymentMethodId(Number(event.target.value))}>
              <option value={0}>
                {paymentMethods.isLoading
                  ? 'Loading payment types...'
                  : paymentMethods.isError
                    ? 'Failed to load payment types'
                    : 'Choose one thing'}
              </option>
              {paymentMethodRows.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Reference No.
            <input className={`${inputClass} mt-1`} value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)} placeholder="(Optional)" />
          </label>
          <label className="text-sm text-gray-600">Amount
            <div className="mt-1 flex"><NumericInput min={0} className={`${inputClass} rounded-r-none text-right`} value={amount || ''} onValueChange={setAmount} /><span className="flex h-10 w-8 items-center justify-center rounded-r border border-l-0 border-gray-300">₹</span></div>
          </label>
        </div>
        <div className="border-y px-5 py-4"><h2 className="text-lg font-semibold">Purchase Bills</h2></div>
        <div className="overflow-x-auto p-5">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['', 'Bill No.', 'Date', 'Supplier', 'Total', 'Balance'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>
              {(purchases.data?.data?.content || []).map((purchase) => (
                <tr key={purchase.purchaseId} className="even:bg-gray-50">
                  <td className="border p-3"><input type="checkbox" checked={purchaseIds.includes(purchase.purchaseId)} onChange={() => togglePurchase(purchase.purchaseId)} /></td>
                  <td className="border p-3 font-semibold">{purchase.purchaseNo || purchase.purchaseCode || `PB/${purchase.purchaseId}`}</td>
                  <td className="border p-3">{purchase.purchaseDate}</td>
                  <td className="border p-3">{purchase.supplierName}</td>
                  <td className="border p-3">{formatCurrency(purchase.grandTotal)}</td>
                  <td className="border p-3">{formatCurrency(purchase.dueAmount || 0)}</td>
                </tr>
              ))}
              {!purchases.data?.data?.content?.length && <tr><td colSpan={6} className="bg-gray-50 p-4 text-center">No purchase bills available</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="p-5">
          <label className="text-sm text-gray-600">Payment Note
            <textarea className="mt-1 h-24 w-full rounded border border-gray-300 p-3" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
        </div>
        <div className="flex gap-3 border-t p-5">
          <Button onClick={submit} isLoading={mutation.isPending}>Submit</Button>
          <Button variant="secondary" onClick={() => navigate('/purchase/payment-out')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
