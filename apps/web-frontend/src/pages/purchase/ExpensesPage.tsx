import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Send, CheckCircle2, IndianRupee } from 'lucide-react';
import { expenseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Expense {
  id: number;
  expenseNumber: string;
  expenseType: string;
  status: string;
  totalAmount: string;
  expenseDate: string;
  description: string | null;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  PAID: 'success',
  REJECTED: 'danger',
};

export default function ExpensesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateExpense = hasPermission(PERMISSIONS.EXPENSE_CREATE);
  const canApproveExpense = hasPermission(PERMISSIONS.EXPENSE_APPROVE);
  const [status, setStatus] = useState('');
  const [payId, setPayId] = useState<number | null>(null);
  const [payMode, setPayMode] = useState('CASH');
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', status, page, pageSize],
    queryFn: () => expenseApi.list({ status: status || undefined, page, pageSize }),
    staleTime: 30_000,
  });

  const rows: Expense[] = ((data as Record<string, unknown>)?.content as Expense[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const submitMutation = useMutation({
    mutationFn: (id: number) => expenseApi.submit(id),
    onSuccess: () => {
      toast.success('Expense submitted');
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => expenseApi.approve(id),
    onSuccess: () => {
      toast.success('Expense approved');
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, mode, date }: { id: number; mode: string; date: string }) =>
      expenseApi.pay(id, { paymentMode: mode, paymentDate: new Date(date).toISOString() }),
    onSuccess: () => {
      toast.success('Expense marked as paid');
      setPayId(null);
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Expense>[] = [
    { key: 'expenseNumber', header: 'Number', mono: true, sortable: true },
    { key: 'expenseType', header: 'Type' },
    { key: 'description', header: 'Description', render: (r) => r.description ?? '—' },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.totalAmount)),
    },
    {
      key: 'expenseDate',
      header: 'Date',
      sortable: true,
      render: (r) => formatDate(r.expenseDate),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<Expense>[] = [
    ...(canCreateExpense
      ? [
          {
            label: 'Submit',
            icon: Send,
            onClick: (r: Expense) => submitMutation.mutate(r.id),
            hidden: (r: Expense) => r.status !== 'DRAFT',
          },
        ]
      : []),
    ...(canApproveExpense
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            onClick: (r: Expense) => approveMutation.mutate(r.id),
            hidden: (r: Expense) => r.status !== 'SUBMITTED',
          },
        ]
      : []),
    ...(canApproveExpense
      ? [
          {
            label: 'Mark Paid',
            icon: IndianRupee,
            onClick: (r: Expense) => {
              setPayId(r.id);
              setPayDate(new Date().toISOString().substring(0, 10));
            },
            hidden: (r: Expense) => r.status !== 'APPROVED',
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Expenses" subtitle="Track and approve business expenses">
        {canCreateExpense && (
          <Button onClick={() => navigate('/purchase/expenses/new')}>+ New Expense</Button>
        )}
      </ERPPageHeader>

      <div className="flex gap-4 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All Statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

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
        actions={rowActions}
      />

      <Modal isOpen={payId !== null} onClose={() => setPayId(null)} title="Mark Expense as Paid">
        <div className="space-y-4">
          <Select
            label="Payment Mode *"
            value={payMode}
            onChange={(e) => setPayMode(e.target.value)}
            options={['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'].map((m) => ({ value: m, label: m }))}
          />
          <Input
            label="Payment Date *"
            type="date"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPayId(null)}>
              Cancel
            </Button>
            <Button
              isLoading={payMutation.isPending}
              onClick={() =>
                payId !== null && payMutation.mutate({ id: payId, mode: payMode, date: payDate })
              }
            >
              Mark Paid
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
