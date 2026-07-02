import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { userApi, branchApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Button from '../../components/ui/Button.js';

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password?: string;
  role: string;
  primaryBranchId?: number;
}

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'SALESPERSON', 'ACCOUNTANT', 'VIEWER'];

export default function UserFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;

  const { data: userData } = useQuery({
    queryKey: ['users', id],
    queryFn: () => userApi.getById(Number(id)),
    enabled: isEdit,
  });
  const user = (userData as Record<string, unknown>)?.data as Record<string, unknown> | undefined;

  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list() });
  const branches = ((branchData as Record<string, unknown>)?.data as Record<string, unknown[]>)?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>();

  useEffect(() => {
    if (user) reset(user as unknown as FormData);
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

  return (
    <div>
      <ERPPageHeader variant="list"
        title={isEdit ? 'Edit User' : 'New User'}
        subtitle={isEdit ? 'Update user details and access.' : 'Create a new staff account.'}
      />

      <form onSubmit={handleSubmit((d) => mutation.mutate(d as unknown as Record<string, unknown>))} className="max-w-2xl space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Input label="First Name" required {...register('firstName', { required: 'Required' })} error={errors.firstName?.message} />
          <Input label="Last Name" {...register('lastName')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Email" type="email" required {...register('email', { required: 'Required' })} error={errors.email?.message} />
          <Input label="Phone" {...register('phone')} />
        </div>
        {!isEdit && (
          <Input
            label="Password"
            type="password"
            required
            {...register('password', { required: 'Required for new user', minLength: { value: 8, message: 'Min 8 chars' } })}
            error={errors.password?.message}
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <Select label="Role" required {...register('role', { required: 'Required' })} error={errors.role?.message}>
            <option value="">Select role…</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
          <Select label="Primary Branch" {...register('primaryBranchId')}>
            <option value="">Select branch…</option>
            {(branches as Record<string, unknown>[]).map((b) => <option key={b.id as number} value={b.id as number}>{b.name as string}</option>)}
          </Select>
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={isSubmitting || mutation.isPending}>{isEdit ? 'Update' : 'Create'} User</Button>
          <Button variant="secondary" type="button" onClick={() => navigate('/users')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
