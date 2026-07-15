import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { accountApi, costCenterApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import Checkbox from '../../components/ui/Checkbox.js';
import {
  accountFormSchema,
  ACCOUNT_TYPES,
  type AccountFormData,
} from '../../schemas/account.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

interface AccountOption {
  id: number;
  accountCode: string;
  name: string;
}
interface CostCenterOption {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

export default function AccountFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data: accountData, isLoading } = useQuery({
    queryKey: ['accounts', id],
    queryFn: () => accountApi.getById(Number(id)),
    enabled: isEdit,
  });
  const account = accountData as Record<string, unknown> | undefined;

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountApi.list(),
  });
  const accounts = ((accountsData as Record<string, unknown[]>)?.content ?? []) as AccountOption[];

  // Gated: don't query/show a cost-center selector for users without COST_CENTER_VIEW,
  // or for tenants who never created any cost center.
  const canViewCostCenters = useAuthStore((s) => s.hasPermission(PERMISSIONS.COST_CENTER_VIEW));
  const { data: costCentersData } = useQuery({
    queryKey: ['cost-centers'],
    queryFn: () => costCenterApi.list(),
    enabled: canViewCostCenters,
  });
  const activeCostCenters = ((costCentersData as CostCenterOption[]) ?? []).filter(
    (cc) => cc.isActive
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<AccountFormData>({
    resolver: zodResolver(accountFormSchema),
  });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (account) reset(account as unknown as AccountFormData);
  }, [account, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? accountApi.update(Number(id), d) : accountApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Account updated' : 'Account created');
      qc.invalidateQueries({ queryKey: ['accounts-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      navigate('/accounting/chart-of-accounts');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isBank = watch('isBank');

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader
          variant="detail"
          title="Edit Account"
          backTo="/accounting/chart-of-accounts"
        />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Account' : 'New Account'}
        backTo="/accounting/chart-of-accounts"
      />

      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))}
        className="space-y-6"
        noValidate
      >
        <ERPFormSection title="Account Details" columns={2}>
          <Input
            label="Account Code"
            required
            {...register('accountCode')}
            error={errors.accountCode?.message}
          />
          <Input label="Account Name" required {...register('name')} error={errors.name?.message} />
          <Select
            label="Account Type"
            required
            {...register('accountType')}
            error={errors.accountType?.message}
          >
            <option value="">Select…</option>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select
            label="Normal Balance"
            required
            {...register('normalBalance')}
            error={errors.normalBalance?.message}
          >
            <option value="">Select…</option>
            <option value="DEBIT">DEBIT</option>
            <option value="CREDIT">CREDIT</option>
          </Select>
          <Select
            label="Parent Account"
            {...register('parentId')}
            error={errors.parentId?.message}
            hint="Leave blank for a root account"
          >
            <option value="">None</option>
            {accounts
              .filter((a) => String(a.id) !== id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountCode} — {a.name}
                </option>
              ))}
          </Select>
          <Input
            label="Opening Balance (₹)"
            type="number"
            step="0.01"
            {...register('openingBalance')}
            error={errors.openingBalance?.message}
          />
          {activeCostCenters.length > 0 && (
            <Select
              label="Default Cost Center"
              {...register('defaultCostCenterId')}
              error={errors.defaultCostCenterId?.message}
              hint="New postings to this account default to this cost center"
            >
              <option value="">None</option>
              {activeCostCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </option>
              ))}
            </Select>
          )}
        </ERPFormSection>

        <ERPFormSection
          title="Bank Details"
          description="Optional — only needed for cash/bank ledger accounts"
          columns={2}
        >
          <div className="flex items-center gap-6 sm:col-span-2">
            <Checkbox label="Cash Account" {...register('isCash')} />
            <Checkbox label="Bank Account" {...register('isBank')} />
          </div>
          {isBank && (
            <>
              <Input label="Bank Name" {...register('bankName')} error={errors.bankName?.message} />
              <Input label="IFSC Code" {...register('bankIfsc')} error={errors.bankIfsc?.message} />
              <Input
                label="Account Number"
                {...register('bankAccountNo')}
                error={errors.bankAccountNo?.message}
                hint="Stored encrypted"
              />
            </>
          )}
        </ERPFormSection>

        <ERPStickyFooter>
          <Button
            variant="secondary"
            type="button"
            onClick={() => navigate('/accounting/chart-of-accounts')}
          >
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Update' : 'Create'} Account
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
