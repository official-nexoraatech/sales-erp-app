import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '../../hooks/useDebounce.js';
import toast from 'react-hot-toast';
import { crmAccountApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import ERPGSTINInput from '../../components/erp/ERPGSTINInput.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import {
  crmAccountFormSchema,
  CRM_ACCOUNT_TYPES,
  type CrmAccountFormData,
} from '../../schemas/crmAccount.schema.js';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard.js';

const ACCOUNT_TYPE_LABELS: Record<(typeof CRM_ACCOUNT_TYPES)[number], string> = {
  B2B: 'B2B',
  WHOLESALE: 'Wholesale',
  DISTRIBUTOR: 'Distributor',
  CORPORATE: 'Corporate',
  INDIVIDUAL: 'Individual',
};

interface DedupeCandidate {
  account: { id: number; name: string };
  score: number;
  reasons: string[];
}

export default function CrmAccountFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [, setGstinStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');

  const { data: accountData, isLoading: accountLoading } = useQuery({
    queryKey: ['crm-accounts', id],
    queryFn: () => crmAccountApi.getById(Number(id)),
    enabled: isEdit,
  });
  const account = accountData as Record<string, unknown> | undefined;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CrmAccountFormData>({
    resolver: zodResolver(crmAccountFormSchema),
  });
  useDirtyFormGuard(isDirty);

  useEffect(() => {
    if (account) reset(account as unknown as CrmAccountFormData);
  }, [account, reset]);

  const gstinValue = watch('gstin');
  const nameValue = watch('name');
  const phoneValue = watch('primaryPhone');
  const emailValue = watch('primaryEmail');
  const debouncedName = useDebounce(nameValue, 400);
  const debouncedPhone = useDebounce(phoneValue, 400);
  const debouncedEmail = useDebounce(emailValue, 400);
  const debouncedGstin = useDebounce(gstinValue, 400);

  // Suggested-not-blocking duplicate check — an indexed lookup, not a full scan, re-run as
  // the user types (debounced). The user can always dismiss and submit anyway.
  const { data: dedupeData } = useQuery({
    queryKey: ['crm-account-dedupe', debouncedName, debouncedPhone, debouncedEmail, debouncedGstin],
    queryFn: () =>
      crmAccountApi.dedupeCheck({
        name: debouncedName || undefined,
        phone: debouncedPhone || undefined,
        email: debouncedEmail || undefined,
        gstin: debouncedGstin || undefined,
      }),
    enabled: !isEdit && !!(debouncedName || debouncedPhone || debouncedEmail || debouncedGstin),
  });
  const [dismissedDedupe, setDismissedDedupe] = useState(false);
  const dedupeCandidates: DedupeCandidate[] = (
    (dedupeData as { content?: DedupeCandidate[] })?.content ?? []
  ).filter(() => !dismissedDedupe);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      isEdit ? crmAccountApi.update(Number(id), d) : crmAccountApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'Account updated' : 'Account created');
      qc.invalidateQueries({ queryKey: ['crm-accounts'] });
      navigate('/crm/accounts');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onSubmit(d: CrmAccountFormData) {
    const payload: Record<string, unknown> = { ...d };
    const line1 = d['billingAddress.line1'];
    if (line1) {
      payload.billingAddress = {
        line1,
        city: d['billingAddress.city'],
        state: d['billingAddress.state'],
        stateCode: INDIAN_STATES.find((s) => s.name === d['billingAddress.state'])?.gstCode,
        pincode: d['billingAddress.pincode'],
      };
    }
    delete payload['billingAddress.line1'];
    delete payload['billingAddress.city'];
    delete payload['billingAddress.state'];
    delete payload['billingAddress.pincode'];
    if (isEdit) payload.version = (account as Record<string, unknown>)?.version ?? 0;
    mutation.mutate(payload);
  }

  if (isEdit && accountLoading) {
    return (
      <div>
        <ERPPageHeader variant="detail" title="Edit Account" backTo="/crm/accounts" />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit Account' : 'New Account'}
        backTo="/crm/accounts"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <ERPFormSection title="Account Details" columns={2}>
          <Input label="Account Name" required {...register('name')} error={errors.name?.message} />
          <Select
            label="Account Type"
            required
            {...register('accountType')}
            error={errors.accountType?.message}
          >
            <option value="">Select…</option>
            {CRM_ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input label="Phone" {...register('primaryPhone')} error={errors.primaryPhone?.message} />
          <Input
            label="Email"
            type="email"
            {...register('primaryEmail')}
            error={errors.primaryEmail?.message}
          />
          <ERPGSTINInput
            label="GSTIN"
            value={gstinValue ?? ''}
            onChange={(val, valid) => {
              setValue('gstin', val, { shouldValidate: true, shouldDirty: true });
              setGstinStatus(val ? (valid ? 'valid' : 'invalid') : 'idle');
            }}
            error={errors.gstin?.message}
          />
        </ERPFormSection>

        <ERPFormSection title="Billing Address" columns={2}>
          <Input
            label="Address Line 1"
            wrapperClassName="sm:col-span-2"
            {...register('billingAddress.line1' as keyof CrmAccountFormData)}
          />
          <Input label="City" {...register('billingAddress.city' as keyof CrmAccountFormData)} />
          <Select label="State" {...register('billingAddress.state' as keyof CrmAccountFormData)}>
            <option value="">Select state…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input
            label="PIN Code"
            {...register('billingAddress.pincode' as keyof CrmAccountFormData)}
          />
        </ERPFormSection>

        {!isEdit && dedupeCandidates.length > 0 && (
          <div className="bg-warning-subtle border border-warning/30 rounded-xl p-4">
            <p className="text-sm font-semibold text-primary mb-2">
              Possible duplicate account{dedupeCandidates.length > 1 ? 's' : ''} found
            </p>
            <div className="space-y-2">
              {dedupeCandidates.map((c) => (
                <div key={c.account.id} className="text-sm text-secondary">
                  <span className="font-medium text-primary">{c.account.name}</span> — {c.score}%
                  match ({c.reasons.join(', ')})
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/crm/accounts/${dedupeCandidates[0]!.account.id}`)}
              >
                View existing account instead
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDismissedDedupe(true)}
              >
                This is a different account
              </Button>
            </div>
          </div>
        )}

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
          <Button variant="secondary" type="button" onClick={() => navigate('/crm/accounts')}>
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
