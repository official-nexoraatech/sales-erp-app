import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierPaymentApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface SupplierPayment {
  id: number;
  paymentNumber: string;
  supplierId: number;
  paymentDate: string;
  paymentMode: string;
  amount: string;
  unallocatedAmount: string;
  status: string;
  isPdc: boolean;
  pdcClearingDate: string | null;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  PAID: 'warning',
  PARTIALLY_ALLOCATED: 'warning',
  FULLY_ALLOCATED: 'success',
  BOUNCED: 'danger',
};

export default function SupplierPaymentsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [pdcClearingDate, setPdcClearingDate] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payments'],
    queryFn: () => supplierPaymentApi.list(),
    staleTime: 30_000,
  });

  const rows: SupplierPayment[] = (data as { data?: SupplierPayment[] })?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => supplierPaymentApi.create(d),
    onSuccess: () => {
      toast.success('Payment recorded');
      setShowCreate(false);
      setAmount('');
      setSupplierId('');
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      supplierPaymentApi.bounce(id, { reason }),
    onSuccess: () => { toast.success('Cheque marked bounced'); qc.invalidateQueries({ queryKey: ['supplier-payments'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const isPdc = paymentMode === 'CHEQUE' && !!pdcClearingDate && new Date(pdcClearingDate) > new Date();

  const columns = [
    { key: 'paymentNumber', header: 'Number', render: (r: SupplierPayment) => <span className="font-mono text-sm">{r.paymentNumber}</span> },
    { key: 'supplierId', header: 'Supplier' },
    {
      key: 'paymentMode',
      header: 'Mode',
      render: (r: SupplierPayment) => (
        <span>
          {r.paymentMode}
          {r.isPdc && <span className="ml-1"><Badge variant="warning">PDC</Badge></span>}
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', render: (r: SupplierPayment) => formatCurrency(parseFloat(r.amount)) },
    {
      key: 'unallocatedAmount',
      header: 'Unallocated',
      render: (r: SupplierPayment) => {
        const u = parseFloat(r.unallocatedAmount);
        return <span className={u > 0 ? 'text-warning font-medium' : 'text-secondary'}>
          {formatCurrency(u)}
        </span>;
      },
    },
    { key: 'paymentDate', header: 'Date', render: (r: SupplierPayment) => formatDate(r.paymentDate) },
    {
      key: 'pdcClearingDate',
      header: 'PDC Clearing',
      render: (r: SupplierPayment) => r.pdcClearingDate ? formatDate(r.pdcClearingDate) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: SupplierPayment) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status.replace('_', ' ')}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r: SupplierPayment) => (
        <div className="flex gap-1">
          {r.paymentMode === 'CHEQUE' && ['PAID', 'PARTIALLY_ALLOCATED'].includes(r.status) && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' })}
            >
              Bounce
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Supplier Payments" subtitle="Record and track payments to suppliers">
        <Button onClick={() => setShowCreate(true)}>+ Record Payment</Button>
      </ERPPageHeader>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No payments found" />

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Record Supplier Payment">
        <div className="space-y-4">
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
                <p className="text-xs text-warning">This will be recorded as a Post-Dated Cheque (PDC).</p>
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
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!supplierId || !amount}
              onClick={() => createMutation.mutate({
                supplierId: Number(supplierId),
                branchId: 1,
                paymentDate: new Date(paymentDate).toISOString(),
                paymentMode,
                amount: parseFloat(amount),
                chequeNumber: chequeNumber || undefined,
                pdcClearingDate: pdcClearingDate ? new Date(pdcClearingDate).toISOString() : undefined,
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
