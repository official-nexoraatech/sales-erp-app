import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Send, CheckCircle2, IndianRupee } from 'lucide-react';
import { expenseApi } from '../../api/endpoints.js';
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

const EXPENSE_TYPES = ['RENT', 'ELECTRICITY', 'SALARY', 'FREIGHT', 'MARKETING', 'MAINTENANCE', 'MISC'] as const;

export default function ExpensesPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateExpense = hasPermission(PERMISSIONS.EXPENSE_CREATE);
  const canApproveExpense = hasPermission(PERMISSIONS.EXPENSE_APPROVE);
  const [status, setStatus] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [expenseType, setExpenseType] = useState<string>('MISC');
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [description, setDescription] = useState('');
  const [lineDesc, setLineDesc] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [lineGst, setLineGst] = useState('0');
  const [payId, setPayId] = useState<number | null>(null);
  const [payMode, setPayMode] = useState('CASH');
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => { setPage(1); }, [status]);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', status, page, pageSize],
    queryFn: () => expenseApi.list({ status: status || undefined, page, pageSize }),
    staleTime: 30_000,
  });

  const rows: Expense[] = (data as Record<string, unknown>)?.content as Expense[] ?? [];
  const totalElements = (data as Record<string, unknown>)?.totalElements as number ?? 0;

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => expenseApi.create(d),
    onSuccess: () => {
      toast.success('Expense created');
      setShowCreate(false);
      setDescription('');
      setLineDesc('');
      setLineAmount('');
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => expenseApi.submit(id),
    onSuccess: () => { toast.success('Expense submitted'); qc.invalidateQueries({ queryKey: ['expenses'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => expenseApi.approve(id),
    onSuccess: () => { toast.success('Expense approved'); qc.invalidateQueries({ queryKey: ['expenses'] }); },
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
    { key: 'totalAmount', header: 'Amount', align: 'right', sortable: true, render: (r) => formatCurrency(parseFloat(r.totalAmount)) },
    { key: 'expenseDate', header: 'Date', sortable: true, render: (r) => formatDate(r.expenseDate) },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canCreateExpense && r.status === 'DRAFT') items.push({ label: 'Submit', icon: Send, onClick: () => submitMutation.mutate(r.id) });
        if (canApproveExpense && r.status === 'SUBMITTED') items.push({ label: 'Approve', icon: CheckCircle2, onClick: () => approveMutation.mutate(r.id) });
        if (canApproveExpense && r.status === 'APPROVED') {
          items.push({ label: 'Mark Paid', icon: IndianRupee, onClick: () => { setPayId(r.id); setPayDate(new Date().toISOString().substring(0, 10)); } });
        }
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Expenses" subtitle="Track and approve business expenses">
        {canCreateExpense && <Button onClick={() => setShowCreate(true)}>+ New Expense</Button>}
      </ERPPageHeader>

      <div className="flex gap-4 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All Statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'].map((s) => (
            <option key={s} value={s}>{s}</option>
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
        onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      />

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Expense">
        <div className="space-y-4">
          <Select
            label="Expense Type *"
            value={expenseType}
            onChange={(e) => setExpenseType(e.target.value)}
            options={EXPENSE_TYPES.map((t) => ({ value: t, label: t }))}
          />
          <Input label="Expense Date *" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="border border-default rounded-lg p-3 space-y-3">
            <p className="text-sm font-medium text-primary">Line Item</p>
            <Input label="Description *" value={lineDesc} onChange={(e) => setLineDesc(e.target.value)} />
            <Input label="Amount *" type="number" value={lineAmount} onChange={(e) => setLineAmount(e.target.value)} />
            <Input label="GST Rate (%)" type="number" value={lineGst} onChange={(e) => setLineGst(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!lineDesc || !lineAmount}
              onClick={() => createMutation.mutate({
                expenseType,
                branchId: 1,
                expenseDate: new Date(expenseDate).toISOString(),
                description: description || undefined,
                lines: [{ description: lineDesc, amount: parseFloat(lineAmount), gstRate: parseFloat(lineGst) || 0 }],
              })}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={payId !== null} onClose={() => setPayId(null)} title="Mark Expense as Paid">
        <div className="space-y-4">
          <Select
            label="Payment Mode *"
            value={payMode}
            onChange={(e) => setPayMode(e.target.value)}
            options={['CASH', 'CHEQUE', 'NEFT', 'RTGS', 'UPI'].map((m) => ({ value: m, label: m }))}
          />
          <Input label="Payment Date *" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPayId(null)}>Cancel</Button>
            <Button
              isLoading={payMutation.isPending}
              onClick={() => payId !== null && payMutation.mutate({ id: payId, mode: payMode, date: payDate })}
            >
              Mark Paid
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
