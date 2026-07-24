import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, paymentInApi, paymentNoteApi, salesApi, usersApi } from '../../../api/endpoints';
import type { PaymentNoteRequest } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { NumericInput } from '../../../components/ui/NumericInput';
import { PageHeader } from '../../../components/ui/PageHeader';
import { PAYMENT_NOTE_PRIORITIES, PAYMENT_NOTE_TYPES } from '../../../types/payment-note.types';
import type { PaymentNotePriority, PaymentNoteType } from '../../../types/payment-note.types';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const PaymentNoteCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedSaleId = Number(searchParams.get('saleId')) || 0;

  const [contactId, setContactId] = useState(0);
  const [saleId, setSaleId] = useState(preselectedSaleId);
  const [paymentId, setPaymentId] = useState(0);
  const [noteType, setNoteType] = useState<PaymentNoteType>('DISCOUNT_NEGOTIATION');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [priority, setPriority] = useState<PaymentNotePriority>('MEDIUM');
  const [assignedToId, setAssignedToId] = useState(0);

  const customers = useQuery({ queryKey: ['payment-note-create-customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }) });
  const sales = useQuery({ queryKey: ['payment-note-create-sales'], queryFn: () => salesApi.getAll({ page: 0, size: 100, search: '' }) });
  const payments = useQuery({ queryKey: ['payment-note-create-payments'], queryFn: () => paymentInApi.getAll({ page: 0, size: 100 }) });
  const users = useQuery({ queryKey: ['payment-note-create-users'], queryFn: () => usersApi.getAll() });

  const selectedCustomerName = customers.data?.data?.content.find((customer) => customer.id === contactId)?.customerName;
  const saleRows = (sales.data?.data?.content || []).filter((sale) => !contactId || sale.customerName === selectedCustomerName);
  const paymentRows = (payments.data?.data?.content || []).filter((payment) => !contactId || payment.customerName === selectedCustomerName);

  const mutation = useMutation({
    mutationFn: (payload: PaymentNoteRequest) => paymentNoteApi.create(payload),
    onSuccess: (response) => {
      toast.success('Payment note created successfully');
      const createdId = response.data?.paymentNoteId;
      navigate(createdId ? `/sales/payment-notes/${createdId}` : '/sales/payment-notes');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create payment note'),
  });

  const submit = () => {
    if (!contactId || !subject.trim()) {
      toast.error('Select a contact and enter a subject.');
      return;
    }
    mutation.mutate({
      contactId,
      saleId: saleId || null,
      paymentId: paymentId || null,
      noteType,
      subject: subject.trim(),
      description: description.trim() || undefined,
      amount: amount || null,
      priority,
      assignedToId: assignedToId || null,
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create Payment Note"
        breadcrumb={<div className="text-sm text-gray-500">Home &gt; Sale &gt; Payment Notes &gt; Create</div>}
      />
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h2 className="text-lg font-semibold text-gray-900">Details</h2></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Contact
            <select className={`${inputClass} mt-1`} value={contactId} onChange={(event) => { setContactId(Number(event.target.value)); setSaleId(0); setPaymentId(0); }}>
              <option value={0}>Select Contact</option>
              {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Related Invoice (optional)
            <select className={`${inputClass} mt-1`} value={saleId} onChange={(event) => setSaleId(Number(event.target.value))}>
              <option value={0}>None</option>
              {saleRows.map((sale) => <option key={sale.saleId} value={sale.saleId}>{sale.invoiceNo}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Related Payment (optional)
            <select className={`${inputClass} mt-1`} value={paymentId} onChange={(event) => setPaymentId(Number(event.target.value))}>
              <option value={0}>None</option>
              {paymentRows.map((payment) => <option key={payment.paymentId} value={payment.paymentId}>{payment.paymentNo}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Note Type
            <select className={`${inputClass} mt-1`} value={noteType} onChange={(event) => setNoteType(event.target.value as PaymentNoteType)}>
              {PAYMENT_NOTE_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Amount
            <div className="mt-1 flex"><NumericInput min={0} className={`${inputClass} rounded-r-none text-right`} value={amount || ''} onValueChange={setAmount} /><span className="flex h-10 w-10 items-center justify-center rounded-r border border-l-0 border-gray-300">Rs.</span></div>
          </label>
          <label className="text-sm text-gray-600 md:col-span-3">Subject
            <input className={`${inputClass} mt-1`} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Short summary, e.g. 5% discount negotiated after billing" />
          </label>
          <label className="text-sm text-gray-600 md:col-span-3">Description
            <textarea className="mt-1 h-28 w-full rounded border border-gray-300 p-3 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Full detail of the negotiation or pending payment" />
          </label>
        </div>

        <div className="border-y px-5 py-4"><h2 className="text-lg font-semibold text-gray-900">Ticket Details</h2></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">Priority
            <select className={`${inputClass} mt-1`} value={priority} onChange={(event) => setPriority(event.target.value as PaymentNotePriority)}>
              {PAYMENT_NOTE_PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">Assign To
            <select className={`${inputClass} mt-1`} value={assignedToId} onChange={(event) => setAssignedToId(Number(event.target.value))}>
              <option value={0}>Unassigned</option>
              {users.data?.data?.content.map((user) => (
                <option key={user.id} value={user.id}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.userName}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-3 border-t p-5">
          <Button onClick={submit} isLoading={mutation.isPending}>Submit</Button>
          <Button variant="secondary" onClick={() => navigate('/sales/payment-notes')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
