import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supplierApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

interface FormData {
  displayName: string;
  supplierType?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  creditDays?: number;
  openingBalance?: number;
}

export default function SupplierFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data: supplierData } = useQuery({
    queryKey: ['suppliers', id],
    queryFn: () => supplierApi.getById(Number(id)),
    enabled: isEdit,
  });
  const supplier = (supplierData as Record<string, unknown>)?.data as Record<string, unknown> | undefined;

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>();

  useEffect(() => {
    if (supplier) reset(supplier as unknown as FormData);
  }, [supplier, reset]);

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
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Supplier' : 'New Supplier'} />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))} className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Display Name" required {...register('displayName', { required: 'Required' })} error={errors.displayName?.message} />
          <Select label="Supplier Type" {...register('supplierType')}>
            <option value="">Select…</option>
            <option value="MANUFACTURER">Manufacturer</option>
            <option value="TRADER">Trader</option>
            <option value="SERVICE">Service Provider</option>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Phone" {...register('phone')} />
          <Input label="Email" type="email" {...register('email')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="GSTIN"
            placeholder="27AAPFU0939F1ZV"
            {...register('gstin', { pattern: { value: GSTIN_RE, message: 'Invalid GSTIN' } })}
            error={errors.gstin?.message}
          />
          <Input label="PAN" {...register('pan')} />
        </div>

        <fieldset className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <legend className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-1">Bank Details</legend>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Bank Name" {...register('bankName')} />
            <Input label="IFSC Code" {...register('bankIfsc')} />
          </div>
          <Input label="Account Number" type="password" {...register('bankAccountNo')} hint="Stored encrypted" />
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Credit Days" type="number" {...register('creditDays')} />
          <Input label="Opening Balance (₹)" type="number" step="0.01" {...register('openingBalance')} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Supplier</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/suppliers')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
