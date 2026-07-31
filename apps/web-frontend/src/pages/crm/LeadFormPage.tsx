import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { leadApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Checkbox from '../../components/ui/Checkbox.js';
import Button from '../../components/ui/Button.js';
import { leadFormSchema, LEAD_SOURCES, type LeadFormData } from '../../schemas/lead.schema.js';

const SOURCE_LABELS: Record<(typeof LEAD_SOURCES)[number], string> = {
  WEBSITE: 'Website',
  REFERRAL: 'Referral',
  WALK_IN: 'Walk-in',
  SOCIAL_MEDIA: 'Social Media',
  ADVERTISEMENT: 'Advertisement',
  PHONE_INQUIRY: 'Phone Inquiry',
  OTHER: 'Other',
};

export default function LeadFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormData>({ resolver: zodResolver(leadFormSchema) });

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => leadApi.create(d),
    onSuccess: () => {
      toast.success('Lead created');
      qc.invalidateQueries({ queryKey: ['leads'] });
      navigate('/crm/leads');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <ERPPageHeader variant="detail" title="New Lead" backTo="/crm/leads" />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-6" noValidate>
        <ERPFormSection title="Lead Details" columns={2}>
          <Input label="Name" {...register('displayName')} error={errors.displayName?.message} />
          <Input label="Company" {...register('companyName')} error={errors.companyName?.message} />
          <Input label="Phone" required {...register('phone')} error={errors.phone?.message} />
          <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
          <Select label="Source" {...register('source')} error={errors.source?.message}>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox {...register('isB2b')} />
            <label className="text-sm text-primary">B2B lead</label>
          </div>
        </ERPFormSection>

        <ERPFormSection title="Notes" columns={1}>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-secondary mb-1.5">Notes</label>
            <textarea
              {...register('notes')}
              rows={3}
              className="w-full rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2 resize-none"
            />
          </div>
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/crm/leads')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            Create Lead
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
