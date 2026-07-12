import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Split, XCircle } from 'lucide-react';
import { paymentApi, customerApi, invoiceApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useBranchStore } from '../../store/branch.store.js';
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
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const user = useAuthStore((s) => s.user);
  const currentBranchId = useBranchStore((s) => s.currentBranchId);
  const branchId = currentBranchId ?? user?.branchIds?.[0] ?? 1;
  const canManagePayment = hasPermission(PERMISSIONS.PAYMENT_CREATE);
  const invoiceIdParam = searchParams.get('invoiceId');
  const invoiceId = invoiceIdParam ? Number(invoiceIdParam) : undefined;
  const [showCreate, setShowCreate] = useState(!!invoiceIdParam);
  const [customerId, setCustomerId] = useState('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [paymentMode, setPaymentMode] = useState<string>('CASH');
  const [amount, setAmount] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', page, pageSize],
    queryFn: () => paymentApi.list({ page, pageSize }),
    staleTime: 30_000,
  });

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

  const rows: Payment[] = ((data as Record<string, unknown>)?.content as Payment[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;
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
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['payments'] });
      if (invoiceId !== undefined) {
        qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
        navigate(`/sales/invoices/${invoiceId}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bounceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      paymentApi.bounceCheque(id, { reason }),
    onSuccess: () => {
      toast.success('Cheque marked bounced');
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Payment>[] = [
    { key: 'paymentNumber', header: 'Number', mono: true },
    { key: 'customerId', header: 'Customer' },
    { key: 'paymentMode', header: 'Mode' },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.amount)),
    },
    {
      key: 'unallocatedAmount',
      header: 'Unallocated',
      align: 'right',
      render: (r) => {
        const u = parseFloat(r.unallocatedAmount);
        return (
          <span className={u > 0 ? 'text-warning font-medium' : 'text-disabled'}>
            {formatCurrency(u)}
          </span>
        );
      },
    },
    {
      key: 'paymentDate',
      header: 'Date',
      sortable: true,
      render: (r) => formatDate(r.paymentDate),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canManagePayment && parseFloat(r.unallocatedAmount) > 0) {
          items.push({
            label: 'Allocate',
            icon: Split,
            onClick: () => navigate(`/sales/payments/${r.id}/allocate`),
          });
        }
        if (canManagePayment && r.paymentMode === 'CHEQUE' && r.status === 'RECEIVED') {
          items.push({
            label: 'Mark Bounced',
            icon: XCircle,
            variant: 'danger',
            onClick: () => bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' }),
          });
        }
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Payments"
        subtitle="Record and allocate customer payments"
      >
        {canManagePayment && <Button onClick={() => setShowCreate(true)}>+ Record Payment</Button>}
      </ERPPageHeader>

      <ERPDataGrid
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Record Payment">
        <div className="space-y-4">
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
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            options={['CASH', 'CARD', 'UPI', 'CHEQUE', 'NEFT', 'RTGS'].map((m) => ({
              value: m,
              label: m,
            }))}
          />
          <Input
            label="Amount"
            required
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {paymentMode === 'CHEQUE' && (
            <Input
              label="Cheque Number"
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
          <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!customerId || !amount}
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
          </div>
        </div>
      </Modal>
    </div>
  );
}
