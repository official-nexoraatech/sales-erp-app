import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { organizationApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

export default function OrganizationPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['organization'], queryFn: () => organizationApi.get() });

  const org = (data as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined;

  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<Record<string, string>>({});

  useEffect(() => {
    if (org) reset(org as Record<string, string>);
  }, [org, reset]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => organizationApi.update(payload),
    onSuccess: () => {
      toast.success('Organization updated');
      qc.invalidateQueries({ queryKey: ['organization'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div>
      <ERPPageHeader variant="list" title="Organization Settings" subtitle="Update your business details and registration information." />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Legal Name" required {...register('legalName', { required: 'Required' })} error={errors.legalName?.message} />
          <Input label="Trade Name" {...register('tradeName')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="GSTIN"
            placeholder="27AAPFU0939F1ZV"
            {...register('gstin', {
              pattern: { value: GSTIN_RE, message: 'Invalid GSTIN format' },
            })}
            error={errors.gstin?.message}
          />
          <Input label="PAN" placeholder="AAPFU0939F" {...register('pan')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Phone" {...register('phone')} />
          <Input label="Email" type="email" {...register('email')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Website" {...register('website')} />
          <Input label="Financial Year Start" type="number" placeholder="4" {...register('financialYearStart')} />
        </div>
        <Input label="Address Line 1" {...register('addressLine1')} />
        <div className="grid grid-cols-3 gap-4">
          <Input label="City" {...register('city')} />
          <Input label="State" {...register('state')} />
          <Input label="PIN Code" {...register('pinCode')} />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending} disabled={!isDirty}>
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
