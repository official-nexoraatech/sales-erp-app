import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { XCircle } from 'lucide-react';
import { supplierPaymentApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
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
  const canManagePayment = useAuthStore((s) => s.hasPermission(PERMISSIONS.PAYMENT_OUT_CREATE));
  const [showCreate, setShowCreate] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [amount, setAmount] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [pdcClearingDate, setPdcClearingDate] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [notes, setNotes] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payments', page, pageSize],
    queryFn: () => supplierPaymentApi.list({ page, pageSize }),
    staleTime: 30_000,
  });

  const rows: SupplierPayment[] = (data as Record<string, unknown>)?.content as SupplierPayment[] ?? [];
  const totalElements = (data as Record<string, unknown>)?.totalElements as number ?? 0;

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

  const columns: ERPColumnDef<SupplierPayment>[] = [
    { key: 'paymentNumber', header: 'Number', mono: true },
    { key: 'supplierId', header: 'Supplier' },
    {
      key: 'paymentMode',
      header: 'Mode',
      render: (r) => (
        <span>
          {r.paymentMode}
          {r.isPdc && <span className="ml-1"><Badge variant="warning">PDC</Badge></span>}
        </span>
      ),
    },
    { key: 'amount', header: 'Amount', align: 'right', sortable: true, render: (r) => formatCurrency(parseFloat(r.amount)) },
    {
      key: 'unallocatedAmount',
      header: 'Unallocated',
      align: 'right',
      render: (r) => {
        const u = parseFloat(r.unallocatedAmount);
        return <span className={u > 0 ? 'text-warning font-medium' : 'text-secondary'}>{formatCurrency(u)}</span>;
      },
    },
    { key: 'paymentDate', header: 'Date', sortable: true, render: (r) => formatDate(r.paymentDate) },
    {
      key: 'pdcClearingDate',
      header: 'PDC Clearing',
      render: (r) => r.pdcClearingDate ? formatDate(r.pdcClearingDate) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status.replace('_', ' ')}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canManagePayment && r.paymentMode === 'CHEQUE' && ['PAID', 'PARTIALLY_ALLOCATED'].includes(r.status)) {
          items.push({ label: 'Mark Bounced', icon: XCircle, variant: 'danger', onClick: () => bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' }) });
        }
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Supplier Payments" subtitle="Record and track payments to suppliers">
        {canManagePayment && <Button onClick={() => setShowCreate(true)}>+ Record Payment</Button>}
      </ERPPageHeader>

      <ERPDataGrid
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />

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
