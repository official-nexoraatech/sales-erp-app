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
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';
import { buildUserFormSchema, type UserFormData } from '../../schemas/user.schema.js';

interface Role {
  id: number;
  name: string;
}

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
  const user = userData as Record<string, unknown> | undefined;

  const { data: roleData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => roleApi.list(),
    enabled: hasPermission(PERMISSIONS.ROLE_VIEW),
  });
  const roles = ((roleData as Record<string, unknown> | undefined)?.['content'] ?? []) as Role[];

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const branches = (branchData as { content?: unknown[] })?.content ?? [];

  const schema = useMemo(() => buildUserFormSchema(isEdit), [isEdit]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UserFormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (user) {
      const roleIds = (user['roleIds'] as number[] | undefined) ?? [];
      const firstRoleId = roleIds[0];
      reset({
        ...(user as unknown as UserFormData),
        ...(firstRoleId !== undefined ? { roleId: firstRoleId } : {}),
      });
    }
  }, [user, reset]);

  const canAssignRole = hasPermission(PERMISSIONS.ROLE_ASSIGN_USER);
  const canManageBranches = hasPermission(PERMISSIONS.USER_MANAGE);

  const mutation = useMutation({
    mutationFn: async (d: UserFormData) => {
      const payload: Record<string, unknown> = { ...d };
      if (!isEdit) {
        payload.roleIds = [d.roleId];
        delete payload.roleId;
        if (d.primaryBranchId) payload.branchIds = [d.primaryBranchId];
        if (!d.password) delete payload.password;
        return userApi.create(payload);
      }

      // Email/role/branch aren't accepted by PUT /users/:id at all — updating them requires
      // the dedicated /roles and /branches endpoints, which this form previously showed as
      // editable fields but silently discarded on submit (a real bug: users saw "User updated"
      // even though their role/branch/email change never took effect).
      delete payload.roleId;
      delete payload.password;
      delete payload.email;
      const result = await userApi.update(Number(id), payload);
      if (canAssignRole && d.roleId) {
        await userApi.updateRoles(Number(id), { roleIds: [d.roleId] });
      }
      if (canManageBranches && d.primaryBranchId) {
        await userApi.assignBranches(Number(id), {
          branchIds: [d.primaryBranchId],
          primaryBranchId: d.primaryBranchId,
        });
      }
      return result;
    },
    onSuccess: () => {
      toast.success(isEdit ? 'User updated' : 'User created');
      qc.invalidateQueries({ queryKey: ['users'] });
      navigate('/users');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function onSubmit(d: UserFormData) {
    mutation.mutate(d);
  }

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title={isEdit ? 'Edit User' : 'New User'}
        subtitle={isEdit ? 'Update user details and access.' : 'Create a new staff account.'}
        backTo="/users"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        <ERPFormSection title="User Details" columns={2}>
          <Input
            label="First Name"
            required
            {...register('firstName')}
            error={errors.firstName?.message}
          />
          <Input
            label="Last Name"
            required
            {...register('lastName')}
            error={errors.lastName?.message}
          />
          <Input
            label="Email"
            type="email"
            required
            disabled={isEdit}
            hint={isEdit ? "Email can't be changed after the account is created" : undefined}
            {...register('email')}
            error={errors.email?.message}
          />
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
          <Select
            label="Role"
            required
            disabled={isEdit && !canAssignRole}
            hint={
              isEdit && !canAssignRole
                ? "You don't have permission to change a user's role"
                : undefined
            }
            {...register('roleId')}
            error={errors.roleId?.message}
          >
            <option value="">Select role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select
            label="Primary Branch"
            disabled={isEdit && !canManageBranches}
            hint={
              !isEdit
                ? 'Leaving this blank lets the user see data for every branch, not just one'
                : !canManageBranches
                  ? "You don't have permission to change a user's branch"
                  : 'Leaving this blank gives the user access to every branch, not just one'
            }
            {...register('primaryBranchId')}
            error={errors.primaryBranchId?.message}
          >
            <option value="">Select branch…</option>
            {(branches as Record<string, unknown>[]).map((b) => (
              <option key={b.id as number} value={b.id as number}>
                {b.name as string}
              </option>
            ))}
          </Select>
        </ERPFormSection>

        <ERPStickyFooter>
          <Button variant="secondary" type="button" onClick={() => navigate('/users')}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting || mutation.isPending}>
            {isEdit ? 'Update' : 'Create'} User
          </Button>
        </ERPStickyFooter>
      </form>
    </div>
  );
}
