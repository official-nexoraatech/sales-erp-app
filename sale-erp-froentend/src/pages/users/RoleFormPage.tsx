import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminRolesApi, rolesApi } from '../../api/endpoints';
import type { RoleRequest } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { useAuth } from '../../hooks/useAuth';
import { isSuperAdminRole } from '../../auth/featurePermissions';
import { OrganizationSelector } from './OrganizationSelector';

interface Props {
  mode: 'create' | 'edit';
}

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const RoleFormPage: React.FC<Props> = ({ mode }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const [searchParams] = useSearchParams();
  const organizationId = Number(searchParams.get('organizationId')) || undefined;
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/users/roles';
  const { user } = useAuth();
  const isSuperAdmin = isSuperAdminRole(user?.role);
  const [form, setForm] = useState<RoleRequest>({ name: '', status: 'ACTIVE', organizationId });

  const role = useQuery({
    queryKey: ['roles', id],
    queryFn: () => rolesApi.getById(id),
    enabled: mode === 'edit' && Boolean(id),
  });

  useEffect(() => {
    if (role.data?.data) {
      const status = role.data.data.status === true || role.data.data.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
      setForm({ name: role.data.data.name || '', status });
    }
  }, [role.data]);

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === 'edit') return rolesApi.update(id, form);
      return isSuperAdmin ? adminRolesApi.create(form) : rolesApi.create(form);
    },
    onSuccess: () => {
      toast.success(`Role ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      navigate(returnTo);
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} role`),
  });

  const submit = () => {
    if (!form.name.trim()) {
      toast.error('Role name is required');
      return;
    }
    if (mode === 'create' && isSuperAdmin && !form.organizationId) {
      toast.error('Organization is required');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Users &gt; Permissions &gt; Roles List &gt; {mode === 'edit' ? 'Edit Role' : 'Create Role'}</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Role Details</h1>
        </div>

        {role.isLoading ? (
          <div className="p-10"><Loader /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
              {mode === 'create' && isSuperAdmin && (
                <OrganizationSelector
                  value={form.organizationId || 0}
                  onChange={(newOrganizationId) => setForm((current) => ({ ...current, organizationId: newOrganizationId || undefined }))}
                  onCreate={() => navigate('/organizations/create?returnTo=/users/roles/create')}
                />
              )}
              <label className="text-sm text-gray-600">
                Role Name
                <input className={`${inputClass} mt-1`} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label className="text-sm text-gray-600">
                Status
                <select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as RoleRequest['status'] }))}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
            </div>

            <div className="flex gap-3 border-t p-5">
              <Button type="button" isLoading={mutation.isPending} onClick={submit}>Submit</Button>
              <Button type="button" variant="secondary" onClick={() => navigate(returnTo)}>Close</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
