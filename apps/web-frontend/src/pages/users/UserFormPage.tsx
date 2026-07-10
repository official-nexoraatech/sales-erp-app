import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { userApi, roleApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { buildUserFormSchema, type UserFormData } from '../../schemas/user.schema.js';

interface Role { id: number; name: string; }

export default function UserFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const isEdit = !!id;

  const { data: userData } = useQuery({
    queryKey: ['users', id],
    queryFn: () => userApi.getById(Number(id)),
    enabled: isEdit,
  });
  const user = (userData as Record<string, unknown> | undefined);

  const { data: roleData } = useQuery({ queryKey: ['roles'], queryFn: () => roleApi.list(), enabled: hasPermission(PERMISSIONS.ROLE_VIEW) });
  const roles = ((roleData as Record<string, unknown> | undefined)?.['content'] ?? []) as Role[];

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list(), enabled: hasPermission(PERMISSIONS.BRANCH_VIEW) });
  const branches = (branchData as { content?: unknown[] })?.content ?? [];

  const schema = useMemo(() => buildUserFormSchema(isEdit), [isEdit]);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<UserFormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (user) {
      const roleIds = (user['roleIds'] as number[] | undefined) ?? [];
      const firstRoleId = roleIds[0];
      reset({ ...(user as unknown as UserFormData), ...(firstRoleId !== undefined ? { roleId: firstRoleId } : {}) });
    }
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => isEdit ? userApi.update(Number(id), d) : userApi.create(d),
    onSuccess: () => {
      toast.success(isEdit ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onSubmit(d: UserFormData) {
    const payload: Record<string, unknown> = { ...d };
    if (!isEdit) {
      payload.roleIds = [d.roleId];
      delete payload.roleId;
      if (d.primaryBranchId) payload.branchIds = [d.primaryBranchId];
      if (!d.password) delete payload.password;
    } else {
      delete payload.roleId;
      delete payload.password;
    }
    mutation.mutate(payload);
  }

  return (
    <div>
      <ERPPageHeader variant="list"
        title={isEdit ? 'Edit User' : 'New User'}
        subtitle={isEdit ? 'Update user details and access.' : 'Create a new staff account.'}
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <ERPFormSection title="User Details" columns={2}>
          <Input label="First Name" required {...register('firstName')} error={errors.firstName?.message} />
          <Input label="Last Name" required {...register('lastName')} error={errors.lastName?.message} />
          <Input label="Email" type="email" required {...register('email')} error={errors.email?.message} />
          <Input label="Phone" {...register('phone')} error={errors.phone?.message} />
          {!isEdit && (
            <Input
              label="Password"
              type="password"
              required
              hint="At least 12 characters"
              {...register('password')}
              error={errors.password?.message}
            />
          )}
        </ERPFormSection>

        <ERPFormSection title="Access" columns={2}>
          <Select label="Role" required {...register('roleId')} error={errors.roleId?.message}>
            <option value="">Select role…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Select label="Primary Branch" {...register('primaryBranchId')} error={errors.primaryBranchId?.message}>
            <option value="">Select branch…</option>
            {(branches as Record<string, unknown>[]).map((b) => <option key={b.id as number} value={b.id as number}>{b.name as string}</option>)}
          </Select>
        </ERPFormSection>

        <div className="flex gap-3">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} User</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/users')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
