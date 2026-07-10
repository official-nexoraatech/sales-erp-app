import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { customerApi, gstApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPGSTINInput from '../../components/erp/ERPGSTINInput.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { GSTIN_REGEX as GSTIN_RE } from '@erp/types';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import { customerFormSchema, CUSTOMER_TYPES, type CustomerFormData } from '../../schemas/customer.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

const CUSTOMER_TYPE_LABELS: Record<(typeof CUSTOMER_TYPES)[number], string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  B2B: 'B2B',
  GOVERNMENT: 'Government',
  EXPORT: 'Export',
};

export default function CustomerFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const userBranchIds = useAuthStore((s) => s.user?.branchIds) ?? [];
  const isEdit = !!id;
  const [gstinStatus, setGstinStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  const { data: customerData, isLoading: customerLoading } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => customerApi.getById(Number(id)),
    enabled: isEdit,
  });
  const customer = (customerData as Record<string, unknown> | undefined);

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list(), enabled: hasPermission(PERMISSIONS.BRANCH_VIEW) });
  const branches = (branchData as { content?: unknown[] })?.content ?? [];

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting, isDirty } } = useForm<CustomerFormData>({
    resolver: zodResolver(customerFormSchema),
  });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (customer) reset(customer as unknown as CustomerFormData);
  }, [customer, reset]);

  // Default to the user's own branch when they're only assigned to one — most
  // customers are created by single-branch staff, so this saves a click.
  useEffect(() => {
    if (!isEdit && userBranchIds.length === 1) setValue('branchId', userBranchIds[0] as number);
  }, [isEdit, userBranchIds, setValue]);

  const gstinValue = watch('gstin');

  async function validateGstin(gstin: string) {
    if (!gstin || !GSTIN_RE.test(gstin)) { setGstinStatus('invalid'); return; }
    try {
      await gstApi.validateHsn(gstin);
      setGstinStatus('valid');
    } catch {
      setGstinStatus('invalid');
    }
  }

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? customerApi.update(Number(id), d) : customerApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Customer updated' : 'Customer created');
      qc.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onSubmit(d: CustomerFormData) {
    const payload: Record<string, unknown> = { ...d };
    const stateName = d['billingAddress.state'];
    if (stateName) {
      payload.billingAddress = {
        line1: d['billingAddress.addressLine1'],
        city: d['billingAddress.city'],
        state: stateName,
        stateCode: INDIAN_STATES.find((s) => s.name === stateName)?.gstCode,
        pincode: d['billingAddress.pinCode'],
      };
    }
    delete payload['billingAddress.addressLine1'];
    delete payload['billingAddress.city'];
    delete payload['billingAddress.state'];
    delete payload['billingAddress.pinCode'];
    mutation.mutate(payload);
  }

  if (isEdit && customerLoading) {
    return (
      <div>
        <ERPPageHeader variant="list" title="Edit Customer" />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Customer' : 'New Customer'} />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <ERPFormSection title="Customer Details" columns={2}>
          <Input label="Display Name" required {...register('displayName')} error={errors.displayName?.message} />
          <Select label="Customer Type" required {...register('customerType')} error={errors.customerType?.message}>
            <option value="">Select…</option>
            {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABELS[t]}</option>)}
          </Select>
          <Select label="Branch" required {...register('branchId')} error={errors.branchId?.message}>
            <option value="">Select branch…</option>
            {(branches as Record<string, unknown>[]).map((b) => <option key={b.id as number} value={b.id as number}>{b.name as string}</option>)}
          </Select>
          <Input label="Phone" required {...register('phone')} error={errors.phone?.message} />
          <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
          <ERPGSTINInput
            label="GSTIN"
            value={gstinValue ?? ''}
            onChange={(val, valid) => {
              const event = { target: { value: val } } as React.ChangeEvent<HTMLInputElement>;
              register('gstin').onChange(event);
              setGstinStatus(val ? (valid ? 'valid' : 'invalid') : 'idle');
            }}
            error={errors.gstin?.message}
          />
          <Input
            label="PAN"
            placeholder="AAPFU0939F"
            {...register('pan')}
            error={errors.pan?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Billing Address" columns={2}>
          <Input label="Address Line 1" wrapperClassName="sm:col-span-2" {...register('billingAddress.addressLine1' as keyof CustomerFormData)} error={errors['billingAddress.addressLine1' as keyof CustomerFormData]?.message} />
          <Input label="City" {...register('billingAddress.city' as keyof CustomerFormData)} error={errors['billingAddress.city' as keyof CustomerFormData]?.message} />
          <Select label="State" {...register('billingAddress.state' as keyof CustomerFormData)} error={errors['billingAddress.state' as keyof CustomerFormData]?.message}>
            <option value="">Select state…</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
          </Select>
          <Input
            label="PIN Code"
            {...register('billingAddress.pinCode' as keyof CustomerFormData)}
            error={errors['billingAddress.pinCode' as keyof CustomerFormData]?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Credit Terms" columns={3}>
          <Input label="Credit Limit (₹)" type="number" step="0.01" {...register('creditLimit')} error={errors.creditLimit?.message} />
          <Input label="Credit Days" type="number" {...register('creditDays')} error={errors.creditDays?.message} />
          <Input label="Opening Balance (₹)" type="number" step="0.01" {...register('openingBalance')} error={errors.openingBalance?.message} />
        </ERPFormSection>

        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Customer</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/customers')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
