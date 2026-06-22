import React, { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { UserRound } from 'lucide-react';
import { usersApi } from '../../api/endpoints';
import type { CreateUserRequest, UserListItem } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { OrganizationSelector } from './OrganizationSelector';
import { RoleSelector } from './RoleSelector';

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

interface Props { mode?: 'create' | 'edit' }

export const UserCreatePage: React.FC<Props> = ({ mode = 'create' }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const [searchParams] = useSearchParams();
  const state = useLocation().state as UserListItem | undefined;
  const { user } = useAuth();
  const pictureRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<CreateUserRequest>({
    firstName: state?.firstName || '',
    lastName: state?.lastName || '',
    userName: state?.userName || state?.username || '',
    email: state?.email || '',
    mobileNo: state?.mobileNo || state?.mobile || '',
    roleId: state?.roleId || 0,
    organizationId: Number(searchParams.get('organizationId')) || user?.organizationId || 0,
    password: '',
    status: state?.status === false || state?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (mode === 'edit') {
        const { organizationId: _organizationId, ...payload } = form;
        return usersApi.update(id, payload);
      }
      return usersApi.create(form);
    },
    onSuccess: () => {
      toast.success(`User ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} user`),
  });

  const setText = (field: keyof CreateUserRequest, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const submit = () => {
    if (!form.firstName.trim()) return toast.error('First name is required');
    if (!form.lastName.trim()) return toast.error('Last name is required');
    if (!form.userName.trim()) return toast.error('Username is required');
    if (!form.email.trim()) return toast.error('Email is required');
    if (!form.roleId) return toast.error('Role is required');
    if (mode === 'create' && !form.organizationId) return toast.error('Organization is required');
    if (mode === 'create' && !form.password.trim()) return toast.error('Password is required');
    mutation.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Users &gt; Users List &gt; {mode === 'edit' ? 'Edit User' : 'Create User'}</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">User Details</h1>
        </div>

        <div className="grid grid-cols-1 gap-x-5 gap-y-4 p-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-gray-600">User Picture</label>
            <div className="flex items-start gap-4">
              <div className="flex h-24 w-24 items-center justify-center rounded border bg-gray-100 text-gray-400">
                <UserRound size={64} />
              </div>
              <div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => pictureRef.current?.click()} className="h-10 rounded border border-blue-500 px-5 text-sm font-semibold text-blue-600">Browse</button>
                  <button type="button" onClick={() => { if (pictureRef.current) pictureRef.current.value = ''; }} className="h-10 rounded border border-gray-300 px-5 text-sm text-gray-700">Reset</button>
                </div>
                <p className="mt-2 text-sm text-gray-500">Allowed JPG, GIF or PNG. Max size of 1MB</p>
                <input ref={pictureRef} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" />
              </div>
            </div>
          </div>
          {mode === 'create' && (
            <OrganizationSelector
              value={form.organizationId}
              onChange={(organizationId) => setForm((current) => ({
                ...current,
                organizationId,
                roleId: organizationId === current.organizationId ? current.roleId : 0,
              }))}
              onCreate={() => navigate('/organizations/create?returnTo=/users/create')}
            />
          )}
          <label className="text-sm text-gray-600">First Name<input className={`${inputClass} mt-1`} value={form.firstName} onChange={(event) => setText('firstName', event.target.value)} /></label>
          <label className="text-sm text-gray-600">Last Name<input className={`${inputClass} mt-1`} value={form.lastName} onChange={(event) => setText('lastName', event.target.value)} /></label>
          <label className="text-sm text-gray-600">Username<input className={`${inputClass} mt-1`} value={form.userName} onChange={(event) => setText('userName', event.target.value)} /></label>
          <label className="text-sm text-gray-600">Email Address<input className={`${inputClass} mt-1`} type="email" value={form.email} onChange={(event) => setText('email', event.target.value)} /></label>
          <label className="text-sm text-gray-600">Mobile<input className={`${inputClass} mt-1`} value={form.mobileNo} onChange={(event) => setText('mobileNo', event.target.value)} /></label>
          <RoleSelector
            organizationId={form.organizationId}
            value={form.roleId}
            onChange={(roleId) => setForm((current) => ({ ...current, roleId }))}
            onCreate={() => navigate(
              `/users/roles/create?organizationId=${form.organizationId}&returnTo=${encodeURIComponent(`/users/create?organizationId=${form.organizationId}`)}`
            )}
          />
          <label className="text-sm text-gray-600">Password<input className={`${inputClass} mt-1`} type="password" value={form.password} onChange={(event) => setText('password', event.target.value)} /></label>
          <label className="text-sm text-gray-600">
            Status
            <select className={`${inputClass} mt-1`} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as CreateUserRequest['status'] }))}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        </div>

        <div className="flex gap-3 border-t p-5">
          <Button type="button" isLoading={mutation.isPending} onClick={submit}>Submit</Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/users')}>Close</Button>
        </div>
      </div>
    </div>
  );
};
