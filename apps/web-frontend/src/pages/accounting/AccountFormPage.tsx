import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { accountApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';

interface FormData {
  accountCode: string;
  name: string;
  accountType: string;
  accountSubType?: string;
  normalBalance: string;
  parentCode?: string;
  openingBalance?: number;
  isBank?: boolean;
  isCash?: boolean;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
}

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'CONTRA'];

export default function AccountFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data: accountData } = useQuery({
    queryKey: ['accounts', id],
    queryFn: () => accountApi.getById(Number(id)),
    enabled: isEdit,
  });
  const account = (accountData as Record<string, unknown>)?.data as Record<string, unknown> | undefined;

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormData>();

  useEffect(() => {
    if (account) reset(account as unknown as FormData);
  }, [account, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? accountApi.update(Number(id), d) : accountApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Account updated' : 'Account created');
      qc.invalidateQueries({ queryKey: ['accounts-tree'] });
      navigate('/accounting/chart-of-accounts');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBank = watch('isBank');

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Account' : 'New Account'} />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))} className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Account Code" required {...register('accountCode', { required: 'Required' })} error={errors.accountCode?.message} />
          <Input label="Account Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Account Type" required {...register('accountType', { required: 'Required' })} error={errors.accountType?.message}>
            <option value="">Select…</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select label="Normal Balance" required {...register('normalBalance', { required: 'Required' })}>
            <option value="">Select…</option>
            <option value="DEBIT">DEBIT</option>
            <option value="CREDIT">CREDIT</option>
          </Select>
        </div>
        <Input label="Parent Account Code" placeholder="e.g. 1000" {...register('parentCode')} hint="Leave blank for root account" />
        <Input label="Opening Balance (₹)" type="number" step="0.01" {...register('openingBalance')} />

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" {...register('isCash')} className="rounded border-gray-300" />
            Cash Account
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" {...register('isBank')} className="rounded border-gray-300" />
            Bank Account
          </label>
        </div>

        {isBank && (
          <fieldset className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
            <legend className="text-xs font-semibold text-gray-500 px-1">Bank Details</legend>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Bank Name" {...register('bankName')} />
              <Input label="IFSC Code" {...register('bankIfsc')} />
            </div>
            <Input label="Account Number" {...register('bankAccountNo')} />
          </fieldset>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Account</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/accounting/chart-of-accounts')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
