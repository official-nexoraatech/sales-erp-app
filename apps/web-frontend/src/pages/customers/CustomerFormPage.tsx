import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { customerApi, gstApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPGSTINInput from '../../components/erp/ERPGSTINInput.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

interface FormData {
  displayName: string;
  customerType: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  creditLimit?: number;
  creditDays?: number;
  openingBalance?: number;
  'billingAddress.addressLine1'?: string;
  'billingAddress.city'?: string;
  'billingAddress.state'?: string;
  'billingAddress.pinCode'?: string;
}

export default function CustomerFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [gstinStatus, setGstinStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  const { data: customerData } = useQuery({
    queryKey: ['customers', id],
    queryFn: () => customerApi.getById(Number(id)),
    enabled: isEdit,
  });
  const customer = (customerData as Record<string, unknown>)?.data as Record<string, unknown> | undefined;

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormData>();

  useEffect(() => {
    if (customer) reset(customer as unknown as FormData);
  }, [customer, reset]);

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

  function onSubmit(d: FormData) {
    const payload: Record<string, unknown> = { ...d };
    payload.billingAddress = {
      addressLine1: d['billingAddress.addressLine1'],
      city: d['billingAddress.city'],
      state: d['billingAddress.state'],
      pinCode: d['billingAddress.pinCode'],
    };
    mutation.mutate(payload);
  }

  return (
    <div>
      <ERPPageHeader variant="list" title={isEdit ? 'Edit Customer' : 'New Customer'} />

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Display Name" required {...register('displayName', { required: 'Required' })} error={errors.displayName?.message} />
          <Select label="Customer Type" required {...register('customerType', { required: 'Required' })} error={errors.customerType?.message}>
            <option value="">Select…</option>
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="CORPORATE">Corporate</option>
            <option value="WALK_IN">Walk-in</option>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Phone" {...register('phone')} />
          <Input label="Email" type="email" {...register('email')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
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
          <Input label="PAN" placeholder="AAPFU0939F" {...register('pan')} />
        </div>

        <ERPFormSection title="Billing Address">
          <Input label="Address Line 1" {...register('billingAddress.addressLine1' as keyof FormData)} />
          <div className="grid grid-cols-3 gap-4">
            <Input label="City" {...register('billingAddress.city' as keyof FormData)} />
            <Input label="State" {...register('billingAddress.state' as keyof FormData)} />
            <Input label="PIN Code" {...register('billingAddress.pinCode' as keyof FormData)} />
          </div>
        </ERPFormSection>

        <div className="grid grid-cols-3 gap-4">
          <Input label="Credit Limit (₹)" type="number" step="0.01" {...register('creditLimit')} />
          <Input label="Credit Days" type="number" {...register('creditDays')} />
          <Input label="Opening Balance (₹)" type="number" step="0.01" {...register('openingBalance')} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} Customer</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/customers')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
