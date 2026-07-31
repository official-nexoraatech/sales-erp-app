import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { paymentApi, customerApi, invoiceApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useBranchStore } from '../../store/branch.store.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

const LIST_PATH = '/sales/payments';

export default function PaymentFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const currentBranchId = useBranchStore((s) => s.currentBranchId);
  const branchId = currentBranchId ?? user?.branchIds?.[0] ?? 1;
  const invoiceIdParam = searchParams.get('invoiceId');
  const invoiceId = invoiceIdParam ? Number(invoiceIdParam) : undefined;

  const [customerId, setCustomerId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState<string>('CASH');
  const [amount, setAmount] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');

  const { data: customerData } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => customerApi.list({}),
  });

  const { data: sourceInvoice } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => invoiceApi.getById(invoiceId as number),
    enabled: invoiceId !== undefined,
  });

  // Arriving from an invoice's "Record Payment" button — prefill the customer and the
  // outstanding balance so the recorded payment matches the invoice that sent us here.
  useEffect(() => {
    if (!sourceInvoice) return;
    const inv = sourceInvoice as { customerId?: number; balanceDue?: string };
    if (inv.customerId) setCustomerId(String(inv.customerId));
    if (inv.balanceDue) setAmount(inv.balanceDue);
  }, [sourceInvoice]);

  const customers =
    (customerData as { content?: Array<{ id: number; displayName: string }> })?.content ?? [];

  const createMutation = useMutation({
    mutationFn: async (d: Record<string, unknown>) => {
      const result = (await paymentApi.create(d)) as { id: number };
      if (invoiceId !== undefined) {
        await paymentApi.allocate(result.id, { allocations: [{ invoiceId, amount: d['amount'] }] });
      }
      return result;
    },
    onSuccess: () => {
      toast.success(
        invoiceId !== undefined ? 'Payment recorded and allocated to invoice' : 'Payment recorded'
      );
      qc.invalidateQueries({ queryKey: ['payments'] });
      if (invoiceId !== undefined) {
        qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        navigate(`/sales/invoices/${invoiceId}`);
      } else {
        navigate(LIST_PATH);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="Record Payment"
        subtitle="Record and allocate a customer payment"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Payment Details" columns={2}>
        <div data-tour-id="sales-payment-new-customer-select">
          <Select
            label="Customer"
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            options={[
              { value: '', label: 'Select customer...' },
              ...customers.map((c) => ({ value: String(c.id), label: c.displayName })),
            ]}
          />
        </div>
        <Input
          label="Payment Date"
          required
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />
        <Select
          label="Payment Mode"
          required
          hint="CHEQUE asks for a cheque number below (needed to mark it bounced later, if it bounces); UPI/NEFT/RTGS/CARD ask for a transaction reference instead."
          value={paymentMode}
          onChange={(e) => setPaymentMode(e.target.value)}
          options={['CASH', 'CARD', 'UPI', 'CHEQUE', 'NEFT', 'RTGS'].map((m) => ({
            value: m,
            label: m,
          }))}
        />
        <div data-tour-id="sales-payment-new-amount-input">
          <Input
            label="Amount"
            required
            type="number"
            hint="Can be less than the invoice's balance due — that's a partial payment, and the invoice stays PARTIALLY_PAID until the rest is collected."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {paymentMode === 'CHEQUE' && (
          <Input
            label="Cheque Number"
            required
            value={chequeNumber}
            onChange={(e) => setChequeNumber(e.target.value)}
          />
        )}
        {['UPI', 'NEFT', 'RTGS', 'CARD'].includes(paymentMode) && (
          <Input
            label="Transaction Reference"
            value={transactionRef}
            onChange={(e) => setTransactionRef(e.target.value)}
          />
        )}
        <Input
          label="Notes"
          wrapperClassName="sm:col-span-2"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          data-tour-id="sales-payment-new-save-button"
          isLoading={createMutation.isPending}
          disabled={
            !customerId || !(parseFloat(amount) > 0) || (paymentMode === 'CHEQUE' && !chequeNumber)
          }
          onClick={() =>
            createMutation.mutate({
              customerId: Number(customerId),
              branchId,
              paymentDate: new Date(paymentDate).toISOString(),
              paymentMode,
              amount: parseFloat(amount),
              chequeNumber: chequeNumber || undefined,
              transactionReference: transactionRef || undefined,
              notes: notes || undefined,
            })
          }
        >
          Record Payment
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
