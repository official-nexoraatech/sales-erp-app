import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import {
  supplierFormSchema,
  SUPPLIER_TYPES,
  type SupplierFormData,
} from '../../schemas/supplier.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

const SUPPLIER_TYPE_LABELS: Record<(typeof SUPPLIER_TYPES)[number], string> = {
  DOMESTIC: 'Domestic',
  IMPORT: 'Import',
  MANUFACTURER: 'Manufacturer',
  AGENT: 'Agent',
};

export default function SupplierFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const userBranchIds = useAuthStore((s) => s.user?.branchIds) ?? [];
  const isEdit = !!id;

  const { data: supplierData } = useQuery({
    queryKey: ['suppliers', id],
    queryFn: () => supplierApi.getById(Number(id)),
    enabled: isEdit,
  });
  const supplier = supplierData as Record<string, unknown> | undefined;

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const branches = (branchData as { content?: unknown[] })?.content ?? [];

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierFormSchema),
  });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (supplier) reset(supplier as unknown as SupplierFormData);
  }, [supplier, reset]);

  useEffect(() => {
    if (!isEdit && userBranchIds.length === 1) setValue('branchId', userBranchIds[0] as number);
  }, [isEdit, userBranchIds, setValue]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? supplierApi.update(Number(id), d) : supplierApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Supplier updated' : 'Supplier created');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/suppliers');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Supplier' : 'New Supplier'}
        backTo="/suppliers"
      />

      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))}
        className="space-y-6"
        noValidate
      >
        <ERPFormSection title="Supplier Details" columns={2}>
          <Input
            label="Display Name"
            required
            {...register('displayName')}
            error={errors.displayName?.message}
          />
          <Select
            label="Supplier Type"
            {...register('supplierType')}
            error={errors.supplierType?.message}
          >
            <option value="">Select…</option>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SUPPLIER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Select
            label="Branch"
            required
            {...register('branchId')}
            error={errors.branchId?.message}
          >
            <option value="">Select branch…</option>
            {(branches as Record<string, unknown>[]).map((b) => (
              <option key={b.id as number} value={b.id as number}>
                {b.name as string}
              </option>
            ))}
          </Select>
          <Input label="Phone" required {...register('phone')} error={errors.phone?.message} />
          <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
          <Input
            label="GSTIN"
            placeholder="27AAPFU0939F1ZV"
            {...register('gstin')}
            error={errors.gstin?.message}
          />
          <Input label="PAN" {...register('pan')} error={errors.pan?.message} />
        </ERPFormSection>

        <ERPFormSection title="Bank Details" columns={2}>
          <Input label="Bank Name" {...register('bankName')} error={errors.bankName?.message} />
          <Input label="IFSC Code" {...register('bankIfsc')} error={errors.bankIfsc?.message} />
          <Input
            label="Account Number"
            type="password"
            {...register('bankAccountNo')}
            error={errors.bankAccountNo?.message}
            hint="Stored encrypted"
          />
        </ERPFormSection>

        <ERPFormSection title="Credit Terms" columns={2}>
          <Input
            label="Credit Days"
            type="number"
            {...register('creditDays')}
            error={errors.creditDays?.message}
          />
          <Input
            label="Opening Balance (₹)"
            type="number"
            step="0.01"
            {...register('openingBalance')}
            error={errors.openingBalance?.message}
          />
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/suppliers')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Update' : 'Create'} Supplier
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
