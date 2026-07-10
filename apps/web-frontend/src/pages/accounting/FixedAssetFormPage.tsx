import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { fixedAssetApi, accountApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import { fixedAssetFormSchema, ASSET_CATEGORIES, type FixedAssetFormData } from '../../schemas/fixed-asset.schema.js';

interface AccountRow {
  id: number;
  name: string;
  accountSubType?: string;
}

export default function FixedAssetFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isEdit = !!id;

  const { data: assetData, isLoading } = useQuery({
    queryKey: ['fixed-assets', id],
    queryFn: () => fixedAssetApi.getById(Number(id)),
    enabled: isEdit,
  });
  const asset = (assetData as Record<string, unknown> | undefined);

  const { data: accData } = useQuery({ queryKey: ['accounts'], queryFn: () => accountApi.list(), enabled: hasPermission(PERMISSIONS.ACCOUNT_VIEW) });
  const accounts = ((accData as Record<string, unknown>)?.content as AccountRow[]) ?? [];

  const assetAccounts = accounts.filter((a) => a.accountSubType === 'FIXED_ASSET');
  const depreciationExpenseAccountsAll = accounts.filter((a) => a.accountSubType === 'OPERATING_EXPENSE');
  const depreciationExpenseAccounts = depreciationExpenseAccountsAll.some((a) => a.name.toLowerCase().includes('depreciation'))
    ? depreciationExpenseAccountsAll.filter((a) => a.name.toLowerCase().includes('depreciation'))
    : depreciationExpenseAccountsAll;
  const accumulatedDepreciationAccounts = accounts.filter((a) => a.accountSubType === 'ACCUMULATED_DEPRECIATION');

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FixedAssetFormData>({
    resolver: zodResolver(fixedAssetFormSchema),
  });

  useEffect(() => {
    if (asset) {
      reset({
        assetCode: asset.assetCode as string,
        assetName: asset.name as string,
        assetCategory: asset.category as string,
        purchaseDate: asset.purchaseDate as string,
        purchaseCost: Number(asset.purchaseCost),
        salvageValue: Number(asset.salvageValue),
        usefulLifeMonths: asset.usefulLifeMonths as number,
        depreciationMethod: asset.depreciationMethod as 'SLM' | 'WDV',
        ...(asset.wdvRate != null ? { wdvRate: Number(asset.wdvRate) } : {}),
        assetAccountId: asset.accountId as number,
        depreciationExpenseAccountId: asset.depreciationExpenseAccountId as number,
        accumulatedDepreciationAccountId: asset.accumulatedDepreciationAccountId as number,
      });
    }
  }, [asset, reset]);

  const mutation = useMutation({
    mutationFn: (d: FixedAssetFormData) =>
      isEdit
        ? fixedAssetApi.update(Number(id), { assetName: d.assetName })
        : fixedAssetApi.create(d as unknown as Record<string, unknown>),
    onSuccess: () => {
      toast.success(isEdit ? 'Asset updated' : 'Asset created');
      qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      navigate('/accounting/fixed-assets');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const depreciationMethod = watch('depreciationMethod');

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="list" title="Edit Asset" />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Asset' : 'New Fixed Asset'} />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-6" noValidate>
        <ERPFormSection title="Asset Details" columns={2}>
          <Input label="Asset Code" required disabled={isEdit} {...register('assetCode')} error={errors.assetCode?.message} />
          <Input label="Asset Name" required {...register('assetName')} error={errors.assetName?.message} />
          <Select label="Category" required disabled={isEdit} {...register('assetCategory')} error={errors.assetCategory?.message}>
            <option value="">Select…</option>
            {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label="Purchase Date" type="date" required disabled={isEdit} {...register('purchaseDate')} error={errors.purchaseDate?.message} />
          <Input label="Purchase Cost (₹)" type="number" step="0.01" required disabled={isEdit} {...register('purchaseCost')} error={errors.purchaseCost?.message} />
          <Input label="Salvage Value (₹)" type="number" step="0.01" disabled={isEdit} {...register('salvageValue')} error={errors.salvageValue?.message} />
          <Input label="Useful Life (Months)" type="number" required disabled={isEdit} {...register('usefulLifeMonths')} error={errors.usefulLifeMonths?.message} />
          <Select label="Depreciation Method" required disabled={isEdit} {...register('depreciationMethod')} error={errors.depreciationMethod?.message}>
            <option value="">Select…</option>
            <option value="SLM">SLM (Straight Line)</option>
            <option value="WDV">WDV (Written Down Value)</option>
          </Select>
          {depreciationMethod === 'WDV' && (
            <Input label="WDV Rate (% p.a.)" type="number" step="0.01" required disabled={isEdit} {...register('wdvRate')} error={errors.wdvRate?.message} />
          )}
        </ERPFormSection>

        <ERPFormSection title="Ledger Accounts" columns={2}>
          <Select
            label="Asset Account"
            required
            disabled={isEdit}
            {...register('assetAccountId')}
            error={errors.assetAccountId?.message}
            hint={assetAccounts.length === 0 ? 'No FIXED_ASSET accounts found in Chart of Accounts' : undefined}
          >
            <option value="">Select…</option>
            {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select
            label="Depreciation Expense Account"
            required
            disabled={isEdit}
            {...register('depreciationExpenseAccountId')}
            error={errors.depreciationExpenseAccountId?.message}
            hint={depreciationExpenseAccounts.length === 0 ? 'No OPERATING_EXPENSE accounts found in Chart of Accounts' : undefined}
          >
            <option value="">Select…</option>
            {depreciationExpenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select
            label="Accumulated Depreciation Account"
            required
            disabled={isEdit}
            {...register('accumulatedDepreciationAccountId')}
            error={errors.accumulatedDepreciationAccountId?.message}
            hint={accumulatedDepreciationAccounts.length === 0 ? 'No ACCUMULATED_DEPRECIATION accounts found in Chart of Accounts' : undefined}
          >
            <option value="">Select…</option>
            {accumulatedDepreciationAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </ERPFormSection>

        {isEdit && (
          <p className="text-xs text-secondary">
            Only the asset name can be changed after creation. Other fields are fixed to preserve accounting integrity.
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Asset</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/accounting/fixed-assets')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
