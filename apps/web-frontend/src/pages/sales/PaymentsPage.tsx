import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { paymentApi, customerApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Payment {
  id: number;
  paymentNumber: string;
  customerId: number;
  paymentDate: string;
  paymentMode: string;
  amount: string;
  unallocatedAmount: string;
  status: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  RECEIVED: 'warning',
  PARTIALLY_ALLOCATED: 'warning',
  FULLY_ALLOCATED: 'success',
  BOUNCED: 'danger',
  REFUNDED: 'default',
};

export default function PaymentsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(!!searchParams.get('invoiceId'));
  const [customerId, setCustomerId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState<string>('CASH');
  const [amount, setAmount] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => paymentApi.list(),
    staleTime: 30_000,
  });

  const { data: customerData } = useQuery({ queryKey: ['customers-list'], queryFn: () => customerApi.list({}) });

  const rows: Payment[] = (data as { data?: Payment[] })?.data ?? [];
  const customers = (customerData as { data?: Array<{ id: number; displayName: string }> })?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => paymentApi.create(d),
    onSuccess: () => {
      toast.success('Payment recorded');
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => paymentApi.bounceCheque(id, { reason }),
    onSuccess: () => { toast.success('Cheque marked bounced'); qc.invalidateQueries({ queryKey: ['payments'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    { key: 'paymentNumber', header: 'Number', className: 'font-mono text-sm' },
    { key: 'customerId', header: 'Customer' },
    { key: 'paymentMode', header: 'Mode' },
    { key: 'amount', header: 'Amount', render: (r: Payment) => formatCurrency(parseFloat(r.amount)) },
    {
      key: 'unallocatedAmount',
      header: 'Unallocated',
      render: (r: Payment) => {
        const u = parseFloat(r.unallocatedAmount);
        return <span className={u > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}>
          {formatCurrency(u)}
        </span>;
      },
    },
    { key: 'paymentDate', header: 'Date', render: (r: Payment) => formatDate(r.paymentDate) },
    { key: 'status', header: 'Status', render: (r: Payment) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r: Payment) => (
        <div className="flex gap-2">
          {parseFloat(r.unallocatedAmount) > 0 && (
            <Button size="sm" onClick={() => navigate(`/sales/payments/${r.id}/allocate`)}>Allocate</Button>
          )}
          {r.paymentMode === 'CHEQUE' && r.status === 'RECEIVED' && (
            <Button size="sm" variant="danger" onClick={() => bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' })}>
              Bounce
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Payments" subtitle="Record and allocate customer payments">
        <Button onClick={() => setShowCreate(true)}>+ Record Payment</Button>
      </ERPPageHeader>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No payments found" />

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Record Payment">
        <div className="space-y-4">
          <Select
            label="Customer *"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            options={[{ value: '', label: 'Select customer...' }, ...customers.map((c) => ({ value: String(c.id), label: c.displayName }))]}
          />
          <Input label="Payment Date *" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          <Select
            label="Payment Mode *"
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            options={['CASH', 'CARD', 'UPI', 'CHEQUE', 'NEFT', 'RTGS'].map((m) => ({ value: m, label: m }))}
          />
          <Input label="Amount *" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {paymentMode === 'CHEQUE' && (
            <Input label="Cheque Number" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} />
          )}
          {['UPI', 'NEFT', 'RTGS', 'CARD'].includes(paymentMode) && (
            <Input label="Transaction Reference" value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} />
          )}
          <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!customerId || !amount}
              onClick={() => createMutation.mutate({
                customerId: Number(customerId),
                branchId: 1,
                paymentDate: new Date(paymentDate).toISOString(),
                paymentMode,
                amount: parseFloat(amount),
                chequeNumber: chequeNumber || undefined,
                transactionReference: transactionRef || undefined,
                notes: notes || undefined,
              })}
            >
              Record Payment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
