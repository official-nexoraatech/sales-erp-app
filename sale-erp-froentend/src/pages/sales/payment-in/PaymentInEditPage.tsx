import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, paymentInApi, paymentMethodApi, salesApi } from '../../../api/endpoints';
import type { PaymentInRequest } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { NumericInput } from '../../../components/ui/NumericInput';
import { formatCurrency } from '../../../utils/formatCurrency';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const PaymentInEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const [customerId, setCustomerId] = useState(0);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethodId, setPaymentMethodId] = useState(0);
  const [referenceNo, setReferenceNo] = useState('');
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [saleIds, setSaleIds] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  const payment = useQuery({ queryKey: ['payment-in', id], queryFn: () => paymentInApi.getById(id), enabled: id > 0 });
  const customers = useQuery({ queryKey: ['payment-in-edit-customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }) });
  const sales = useQuery({ queryKey: ['payment-in-edit-sales'], queryFn: () => salesApi.getAll({ page: 0, size: 100, search: '' }) });
  const paymentMethods = useQuery({ queryKey: ['payment-in-edit-payment-methods'], queryFn: () => paymentMethodApi.getAll('') });
  const paymentMethodRows = (paymentMethods.data?.data?.content || [])
    .filter((method) => method.status === 'ACTIVE' || method.id === paymentMethodId);
  const saleRows = (sales.data?.data?.content || []).filter((sale) => !customerId || sale.customerName === customers.data?.data?.content.find((customer) => customer.id === customerId)?.customerName);

  useEffect(() => {
    const data = payment.data?.data;
    if (!data || loaded) return;
    setCustomerId(data.party.id);
    setPaymentDate(data.paymentDate);
    setPaymentMethodId(data.paymentMethod.id);
    setReferenceNo(data.referenceNo || '');
    setAmount(data.amount);
    setNotes(data.notes || '');
    setSaleIds(data.saleIds || []);
    setLoaded(true);
  }, [payment.data, loaded]);

  const mutation = useMutation({
    mutationFn: (payload: PaymentInRequest) => paymentInApi.update(id, payload),
    onSuccess: () => {
      toast.success('Payment in updated successfully');
      navigate('/sales/payment-in');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update payment in'),
  });

  const toggleSale = (saleId: number) => {
    setSaleIds((current) => current.includes(saleId) ? current.filter((entry) => entry !== saleId) : [...current, saleId]);
  };
  const submit = () => {
    if (!customerId || !paymentMethodId || amount <= 0) {
      toast.error('Select customer, payment method, and valid amount.');
      return;
    }
    mutation.mutate({ customerId, paymentDate, paymentMethodId, referenceNo, amount, notes, saleIds });
  };

  if (payment.isLoading || !loaded) return <div className="flex h-64 items-center justify-center"><Loader size="lg" /></div>;

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Sale &gt; Payment In &gt; Edit Payment In</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Payment In Details</h1></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Customer
            <select className={`${inputClass} mt-1`} value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>
              <option value={0}>Select Customer</option>
              {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
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
            <div className="mt-1 flex"><NumericInput min={0} className={`${inputClass} rounded-r-none text-right`} value={amount || ''} onValueChange={setAmount} /><span className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-gray-300">Rs.</span></div>
          </label>
        </div>
        <div className="border-y px-5 py-4"><h2 className="text-lg font-semibold">Sales Invoices</h2></div>
        <div className="overflow-x-auto p-5">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{['', 'Invoice No.', 'Date', 'Customer', 'Total', 'Balance'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>
              {saleRows.map((sale) => (
                <tr key={sale.saleId} className="even:bg-gray-50">
                  <td className="border p-3"><input type="checkbox" checked={saleIds.includes(sale.saleId)} onChange={() => toggleSale(sale.saleId)} /></td>
                  <td className="border p-3 font-semibold">{sale.invoiceNo}</td>
                  <td className="border p-3">{sale.invoiceDate}</td>
                  <td className="border p-3">{sale.customerName}</td>
                  <td className="border p-3">{formatCurrency(sale.grandTotal)}</td>
                  <td className="border p-3">{formatCurrency(sale.dueAmount || 0)}</td>
                </tr>
              ))}
              {!saleRows.length && <tr><td colSpan={6} className="bg-gray-50 p-4 text-center">No sales invoices available</td></tr>}
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
          <Button variant="secondary" onClick={() => navigate('/sales/payment-in')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
