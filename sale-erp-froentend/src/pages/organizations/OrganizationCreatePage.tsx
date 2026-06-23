import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { organizationApi } from '../../api/endpoints';
import type { OrganizationAddress, UpdateOrganizationRequest } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { OrganizationForm } from './OrganizationForm';
import { emptyOrganizationAddress, emptyOrganizationForm, toCreateOrganizationRequest } from './organization.utils';

const createEmptyForm = (): UpdateOrganizationRequest => ({
  ...emptyOrganizationForm,
  address: { ...emptyOrganizationAddress },
});

export const OrganizationCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/organizations';
  const [form, setForm] = useState<UpdateOrganizationRequest>(createEmptyForm);

  const mutation = useMutation({
    mutationFn: () => organizationApi.create(toCreateOrganizationRequest(form)),
    onSuccess: async () => {
      toast.success('Organization created successfully');
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      navigate(returnTo);
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create organization'),
  });

  const set = <K extends keyof UpdateOrganizationRequest>(field: K, value: UpdateOrganizationRequest[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setAddress = <K extends keyof OrganizationAddress>(field: K, value: OrganizationAddress[K]) => {
    setForm((current) => ({ ...current, address: { ...current.address, [field]: value } }));
  };

  const submit = () => {
    if (!form.name.trim()) {
      toast.error('Organization name is required');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Organization &gt; Organization List &gt; Create Organization</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Organization Details</h1></div>
        <OrganizationForm form={form} onChange={set} onAddressChange={setAddress} />
        <div className="flex gap-3 border-t p-5">
          <Button onClick={submit} isLoading={mutation.isPending}>Submit</Button>
          <Button variant="secondary" onClick={() => navigate(returnTo)}>Close</Button>
        </div>
      </div>
    </div>
  );
};
