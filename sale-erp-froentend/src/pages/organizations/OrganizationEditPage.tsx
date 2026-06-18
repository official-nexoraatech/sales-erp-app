import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { organizationApi } from '../../api/endpoints';
import type { Organization, OrganizationAddress, UpdateOrganizationRequest } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { OrganizationForm } from './OrganizationForm';
import {
  emptyOrganizationAddress,
  emptyOrganizationForm,
  getOrganizationId,
  getOrganizationStatus,
  getUploadedOrganizationLogoUrl,
  normalizeOrganizationAddress,
  toOrganizationAddressRequest,
} from './organization.utils';

const createEmptyForm = (): UpdateOrganizationRequest => ({
  ...emptyOrganizationForm,
  address: { ...emptyOrganizationAddress },
});

const toForm = (organization: Organization): UpdateOrganizationRequest => ({
  name: organization.name || '',
  description: organization.description || '',
  logoUrl: organization.logoUrl || '',
  address: normalizeOrganizationAddress(organization.address),
  status: getOrganizationStatus(organization.status),
});

export const OrganizationEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const state = useLocation().state as Organization | undefined;
  const [form, setForm] = useState<UpdateOrganizationRequest>(state ? toForm(state) : createEmptyForm);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const organizations = useQuery({
    queryKey: ['organizations', 'edit-prefill'],
    queryFn: () => organizationApi.getAll(''),
    enabled: !state && Number.isFinite(id) && id > 0,
  });

  const organization = useMemo(() => {
    if (state && getOrganizationId(state) === id) return state;
    return organizations.data?.data?.content.find((entry) => getOrganizationId(entry) === id);
  }, [id, organizations.data?.data?.content, state]);

  useEffect(() => {
    if (organization) setForm(toForm(organization));
  }, [organization]);

  const mutation = useMutation({
    mutationFn: async () => {
      let logoUrl = form.logoUrl || '';
      if (logoFile) {
        const uploadResponse = await organizationApi.uploadLogo(id, logoFile);
        logoUrl = getUploadedOrganizationLogoUrl(uploadResponse);
        if (!logoUrl) throw new Error('Logo upload did not return a URL');
      }
      await organizationApi.update(id, { ...form, logoUrl, address: toOrganizationAddressRequest(form.address) });
    },
    onSuccess: async () => {
      toast.success('Organization updated successfully');
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      navigate('/organizations');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update organization'),
  });

  const set = <K extends keyof UpdateOrganizationRequest>(field: K, value: UpdateOrganizationRequest[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setAddress = <K extends keyof OrganizationAddress>(field: K, value: OrganizationAddress[K]) => {
    setForm((current) => ({ ...current, address: { ...current.address, [field]: value } }));
  };

  const submit = () => {
    if (!Number.isFinite(id) || id <= 0) {
      toast.error('Organization id is missing');
      return;
    }
    if (!form.name.trim()) {
      toast.error('Organization name is required');
      return;
    }
    mutation.mutate();
  };

  if (!state && organizations.isLoading) return <div className="p-10"><Loader /></div>;

  if (!organization) {
    return (
      <div className="space-y-5">
        <div className="text-sm text-gray-500">Home &gt; Organization &gt; Organization List &gt; Edit Organization</div>
        <div className="rounded-lg bg-white p-6 shadow">
          <p className="text-sm text-gray-600">Organization not found.</p>
          <Button className="mt-4" variant="secondary" onClick={() => navigate('/organizations')}>Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Organization &gt; Organization List &gt; Edit Organization</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Organization Details</h1></div>
        <OrganizationForm form={form} onChange={set} onAddressChange={setAddress} showLogoUpload logoFile={logoFile} onLogoFileChange={setLogoFile} />
        <div className="flex gap-3 border-t p-5">
          <Button onClick={submit} isLoading={mutation.isPending}>Submit</Button>
          <Button variant="secondary" onClick={() => navigate('/organizations')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
