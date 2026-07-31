import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { opportunityApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import {
  opportunityFormSchema,
  type OpportunityFormData,
} from '../../schemas/opportunity.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

// CRM-ROADMAP Phase 2, Feature 1. Line items are added afterward on the detail page (a deal
// with zero line items is explicitly allowed pre-Won, per this feature's own stated edge case)
// — this form only captures the top-level forecast attributes.
export default function OpportunityFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data, isLoading } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => opportunityApi.get(Number(id)),
    enabled: isEdit,
  });
  const opportunity = data as Record<string, unknown> | undefined;
  // CRM-ROADMAP Phase 3, Feature 6: the GET this form pre-fills from omits `value` entirely
  // when the caller lacks OPPORTUNITY_VALUE_VIEW. Without this guard, the form would default
  // the hidden field to 0 and silently overwrite the deal's real value on save.
  const valueHidden = isEdit && !!opportunity && opportunity['value'] === undefined;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<OpportunityFormData>({ resolver: zodResolver(opportunityFormSchema) });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (opportunity) {
      reset({
        name: opportunity['name'] as string,
        dealType: (opportunity['dealType'] as string | undefined) ?? undefined,
        value: parseFloat((opportunity['value'] as string) ?? '0'),
        expectedCloseDate: opportunity['expectedCloseDate']
          ? String(opportunity['expectedCloseDate']).slice(0, 10)
          : undefined,
        customerId: opportunity['customerId'] as number | undefined,
        accountId: opportunity['accountId'] as number | undefined,
        branchId: opportunity['branchId'] as number | undefined,
        notes: (opportunity['notes'] as string | undefined) ?? undefined,
      });
    }
  }, [opportunity, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? opportunityApi.update(Number(id), d) : opportunityApi.create(d),
    onSuccess: (res) => {
      toast.success(isEdit ? 'Opportunity updated' : 'Opportunity created');
      qc.invalidateQueries({ queryKey: ['opportunities'] });
      const newId = isEdit ? Number(id) : ((res as { id?: number })?.id ?? undefined);
      navigate(newId ? `/crm/pipeline/${newId}` : '/crm/pipeline');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onSubmit(d: OpportunityFormData) {
    const payload: Record<string, unknown> = {
      ...d,
      expectedCloseDate: d.expectedCloseDate
        ? new Date(d.expectedCloseDate).toISOString()
        : undefined,
    };
    // Never send the placeholder 0 back as a real update — leaves the deal's actual value
    // untouched server-side (PUT treats a missing `value` key as "don't touch this column").
    if (valueHidden) delete payload.value;
    if (isEdit) payload.version = (opportunity as Record<string, unknown>)?.version ?? 0;
    mutation.mutate(payload);
  }

  if (isEdit && isLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Opportunity" backTo="/crm/pipeline" />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Opportunity' : 'New Opportunity'}
        backTo="/crm/pipeline"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <ERPFormSection title="Deal Details" columns={2}>
          <Input label="Deal Name" required {...register('name')} error={errors.name?.message} />
          <Input label="Deal Type" {...register('dealType')} error={errors.dealType?.message} />
          {valueHidden ? (
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                Estimated Value
              </label>
              <p className="text-sm text-disabled italic py-2">
                Hidden — you don't have permission to view or edit deal value.
              </p>
            </div>
          ) : (
            <Input
              label="Estimated Value"
              type="number"
              step="0.01"
              required
              {...register('value')}
              error={errors.value?.message}
            />
          )}
          <Input label="Expected Close Date" type="date" {...register('expectedCloseDate')} />
          <Input
            label="Customer ID"
            type="number"
            {...register('customerId')}
            error={errors.customerId?.message}
          />
          <Input
            label="Account ID"
            type="number"
            {...register('accountId')}
            error={errors.accountId?.message}
          />
          <Input
            label="Branch ID"
            type="number"
            {...register('branchId')}
            error={errors.branchId?.message}
          />
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
          <Button variant="secondary" type="button" onClick={() => navigate('/crm/pipeline')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Update' : 'Create'} Opportunity
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
