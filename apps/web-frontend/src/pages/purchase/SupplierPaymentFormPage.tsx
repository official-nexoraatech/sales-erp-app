import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierPaymentApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

const LIST_PATH = '/purchase/payments';

export default function SupplierPaymentFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Was hardcoded to 1 — same latent multi-tenant bug class fixed elsewhere this session.
  const userBranchId = useAuthStore((s) => s.user?.branchIds?.[0]);

  const [supplierId, setSupplierId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [pdcClearingDate, setPdcClearingDate] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => supplierPaymentApi.create(d),
    onSuccess: () => {
      toast.success('Payment recorded');
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      navigate(LIST_PATH);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPdc =
    paymentMode === 'CHEQUE' && !!pdcClearingDate && new Date(pdcClearingDate) > new Date();

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="Record Supplier Payment"
        subtitle="Record a payment made to a supplier"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Payment Details" columns={2}>
        <Input
          label="Supplier ID *"
          type="number"
          placeholder="Supplier ID"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        />
        <Input
          label="Payment Date *"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />
        <Select
          label="Payment Mode *"
          value={paymentMode}
          onChange={(e) => setPaymentMode(e.target.value)}
          options={['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'].map((m) => ({ value: m, label: m }))}
        />
        <Input
          label="Amount *"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {paymentMode === 'CHEQUE' && (
          <>
            <Input
              label="Cheque Number"
              value={chequeNumber}
              onChange={(e) => setChequeNumber(e.target.value)}
            />
            <Input
              label="PDC Clearing Date (leave blank if not PDC)"
              type="date"
              value={pdcClearingDate}
              onChange={(e) => setPdcClearingDate(e.target.value)}
            />
            {isPdc && (
              <p className="text-xs text-warning sm:col-span-2">
                This will be recorded as a Post-Dated Cheque (PDC).
              </p>
            )}
          </>
        )}
        {['UPI', 'NEFT', 'RTGS'].includes(paymentMode) && (
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
          isLoading={createMutation.isPending}
          disabled={!supplierId || !amount}
          onClick={() =>
            createMutation.mutate({
              supplierId: Number(supplierId),
              branchId: userBranchId,
              paymentDate: new Date(paymentDate).toISOString(),
              paymentMode,
              amount: parseFloat(amount),
              chequeNumber: chequeNumber || undefined,
              pdcClearingDate: pdcClearingDate
                ? new Date(pdcClearingDate).toISOString()
                : undefined,
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
