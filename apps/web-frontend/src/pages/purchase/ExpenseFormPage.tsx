import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { expenseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

const EXPENSE_TYPES = [
  'RENT',
  'ELECTRICITY',
  'SALARY',
  'FREIGHT',
  'MARKETING',
  'MAINTENANCE',
  'MISC',
] as const;
const LIST_PATH = '/purchase/expenses';

export default function ExpenseFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Was hardcoded to 1 — only "worked" for tenants whose first-ever branch happened to get
  // global id 1. Same latent multi-tenant bug class fixed elsewhere this session.
  const userBranchId = useAuthStore((s) => s.user?.branchIds?.[0]);

  const [expenseType, setExpenseType] = useState<string>('MISC');
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [description, setDescription] = useState('');
  const [lineDesc, setLineDesc] = useState('');
  const [lineAmount, setLineAmount] = useState('');
  const [lineGst, setLineGst] = useState('0');

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => expenseApi.create(d),
    onSuccess: () => {
      toast.success('Expense created');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      navigate(LIST_PATH);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Expense"
        subtitle="Track a business expense"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Expense Details" columns={2}>
        <Select
          label="Expense Type *"
          value={expenseType}
          onChange={(e) => setExpenseType(e.target.value)}
          options={EXPENSE_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <Input
          label="Expense Date *"
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
        />
        <Input
          label="Description"
          wrapperClassName="sm:col-span-2"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </ERPFormSection>

      <ERPFormSection title="Line Item" columns={3}>
        <Input
          label="Description *"
          value={lineDesc}
          onChange={(e) => setLineDesc(e.target.value)}
        />
        <Input
          label="Amount *"
          type="number"
          value={lineAmount}
          onChange={(e) => setLineAmount(e.target.value)}
        />
        <Input
          label="GST Rate (%)"
          type="number"
          value={lineGst}
          onChange={(e) => setLineGst(e.target.value)}
        />
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          isLoading={createMutation.isPending}
          disabled={!lineDesc || !lineAmount}
          onClick={() =>
            createMutation.mutate({
              expenseType,
              branchId: userBranchId,
              expenseDate: new Date(expenseDate).toISOString(),
              description: description || undefined,
              lines: [
                {
                  description: lineDesc,
                  amount: parseFloat(lineAmount),
                  gstRate: parseFloat(lineGst) || 0,
                },
              ],
            })
          }
        >
          Create Expense
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
