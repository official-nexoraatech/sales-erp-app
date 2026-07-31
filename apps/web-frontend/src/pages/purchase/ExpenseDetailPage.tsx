import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { expenseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPDetailSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface ExpenseLine {
  id: number;
  description: string;
  amount: string;
  gstRate: string;
  gstAmount: string;
  lineTotal: string;
}

interface ExpenseDetail {
  id: number;
  expenseNumber: string;
  expenseType: string;
  status: string;
  supplierId?: number | null;
  expenseDate: string;
  dueDate?: string | null;
  description?: string | null;
  totalAmount: string;
  paidAmount: string;
  paymentMode?: string | null;
  paymentDate?: string | null;
  paymentReference?: string | null;
  notes?: string | null;
  lines: ExpenseLine[];
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  PAID: 'success',
};

export default function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.EXPENSE_CREATE);
  const canApprove = hasPermission(PERMISSIONS.EXPENSE_APPROVE);

  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState('CASH');
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [payReference, setPayReference] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['expense-detail', id],
    queryFn: () => expenseApi.getById(Number(id)),
    enabled: !!id,
  });

  const expense = data as ExpenseDetail | undefined;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['expense-detail', id] });
  }

  const submitMutation = useMutation({
    mutationFn: () => expenseApi.submit(Number(id)),
    onSuccess: () => {
      toast.success('Expense submitted');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => expenseApi.approve(Number(id)),
    onSuccess: () => {
      toast.success('Expense approved');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payMutation = useMutation({
    mutationFn: () =>
      expenseApi.pay(Number(id), {
        paymentMode: payMode,
        paymentDate: new Date(payDate).toISOString(),
        ...(payReference ? { paymentReference: payReference } : {}),
      }),
    onSuccess: () => {
      toast.success('Expense marked as paid');
      setPayOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <ERPDetailSkeleton />;
  if (!expense) return <ERPEmptyState type="no-data" title="Expense not found" />;

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={expense.expenseNumber}
        entityType="Expense"
        entityNumber={expense.expenseNumber}
        status={expense.status}
        backTo="/purchase/expenses"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={STATUS_COLORS[expense.status] ?? 'default'}>{expense.status}</Badge>
          {canCreate && expense.status === 'DRAFT' && (
            <Button isLoading={submitMutation.isPending} onClick={() => submitMutation.mutate()}>
              Submit
            </Button>
          )}
          {canApprove && ['SUBMITTED', 'PENDING_APPROVAL'].includes(expense.status) && (
            <Button isLoading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
              Approve
            </Button>
          )}
          {canApprove && expense.status === 'APPROVED' && (
            <Button onClick={() => setPayOpen(true)}>Mark Paid</Button>
          )}
        </div>
      </ERPPageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Type', value: expense.expenseType },
          { label: 'Expense Date', value: formatDate(expense.expenseDate) },
          { label: 'Due Date', value: expense.dueDate ? formatDate(expense.dueDate) : '—' },
          { label: 'Total Amount', value: formatCurrency(parseFloat(expense.totalAmount)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface-card rounded-xl border border-default p-4">
            <div className="text-xs text-secondary">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-surface-card border border-default rounded-xl p-4 mb-4">
        <h3 className="font-semibold mb-3">Line Items</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary border-b border-default">
              <th className="pb-2">Description</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2 text-right">GST %</th>
              <th className="pb-2 text-right">GST Amount</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {expense.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right">{formatCurrency(parseFloat(l.amount))}</td>
                <td className="py-2 text-right">{l.gstRate}%</td>
                <td className="py-2 text-right">{formatCurrency(parseFloat(l.gstAmount))}</td>
                <td className="py-2 text-right font-medium">
                  {formatCurrency(parseFloat(l.lineTotal))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {expense.status === 'PAID' && (
        <div className="bg-surface-card border border-default rounded-xl p-4 mb-4 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-secondary">Paid Amount</span>
            <span>{formatCurrency(parseFloat(expense.paidAmount))}</span>
          </div>
          {expense.paymentMode && (
            <div className="flex justify-between">
              <span className="text-secondary">Payment Mode</span>
              <span>{expense.paymentMode}</span>
            </div>
          )}
          {expense.paymentDate && (
            <div className="flex justify-between">
              <span className="text-secondary">Payment Date</span>
              <span>{formatDate(expense.paymentDate)}</span>
            </div>
          )}
          {expense.paymentReference && (
            <div className="flex justify-between">
              <span className="text-secondary">Reference</span>
              <span>{expense.paymentReference}</span>
            </div>
          )}
        </div>
      )}

      {(expense.description || expense.notes) && (
        <div className="bg-surface-card border border-default rounded-xl p-4 text-sm space-y-2">
          {expense.description && (
            <div>
              <span className="font-medium text-primary">Description: </span>
              <span className="text-secondary">{expense.description}</span>
            </div>
          )}
          {expense.notes && (
            <div>
              <span className="font-medium text-primary">Notes: </span>
              <span className="text-secondary">{expense.notes}</span>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={payOpen} onClose={() => setPayOpen(false)} title="Mark Expense as Paid">
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
          <Input
            label="Payment Reference"
            value={payReference}
            onChange={(e) => setPayReference(e.target.value)}
            placeholder="e.g. Transaction ID"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPayOpen(false)}>
              Cancel
            </Button>
            <Button isLoading={payMutation.isPending} onClick={() => payMutation.mutate()}>
              Mark Paid
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
