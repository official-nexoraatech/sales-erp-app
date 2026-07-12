import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { adminUserApi, adminTenantApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useUrlParams, toNumber } from '../../hooks/useUrlParam.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Modal from '../../components/ui/Modal.js';
import PasswordInput from '../../components/ui/PasswordInput.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

const URL_DEFAULTS = { q: '', status: '', page: '1', size: '20' };

interface TenantUser {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  lockedUntil?: string;
}

const resetSchema = z
  .object({
    currentPassword: z.string().min(1, 'Your current password is required'),
    newPassword: z.string().min(12, 'Must be at least 12 characters').max(128),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type ResetFormData = z.infer<typeof resetSchema>;

export default function AdminTenantUsersPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const id = Number(tenantId);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: tenant } = useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: () => adminTenantApi.getById(id),
  });

  const [urlState, setUrlState] = useUrlParams(URL_DEFAULTS);
  const [search, setSearch] = useState(urlState.q);
  const debouncedSearch = useDebounce(search, 250);
  const status = urlState.status;
  const page = toNumber(urlState.page, 1);
  const pageSize = toNumber(urlState.size, 20);

  function setStatus(v: string): void {
    setUrlState({ status: v, page: '1' });
  }
  function setPage(p: number): void {
    setUrlState({ page: String(p) });
  }
  function setPageSize(s: number): void {
    setUrlState({ size: String(s), page: '1' });
  }

  const isFirstSearchRun = useRef(true);
  useEffect(() => {
    if (isFirstSearchRun.current) {
      isFirstSearchRun.current = false;
      return;
    }
    setUrlState({ q: debouncedSearch, page: '1' });
  }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenant-users', id, debouncedSearch, status, page, pageSize],
    queryFn: () =>
      adminUserApi.listByTenant(id, {
        search: debouncedSearch || undefined,
        status: status || undefined,
        page: page - 1,
        size: pageSize,
      }),
  });
  const tenantUsers: TenantUser[] = (data as { content?: TenantUser[] })?.content ?? [];
  const totalElements = (data as { totalElements?: number })?.totalElements ?? 0;

  const [resetTarget, setResetTarget] = useState<TenantUser | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  });

  const resetMutation = useMutation({
    mutationFn: (d: ResetFormData) =>
      adminUserApi.resetPassword(id, resetTarget!.id, {
        currentPassword: d.currentPassword,
        newPassword: d.newPassword,
      }),
    onSuccess: () => {
      toast.success(`Password reset for ${resetTarget?.email}`);
      qc.invalidateQueries({ queryKey: ['admin-tenant-users', id] });
      setResetTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openResetDialog(user: TenantUser): void {
    reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setResetTarget(user);
  }

  const columns: ERPColumnDef<TenantUser>[] = [
    {
      key: 'firstName',
      header: 'Name',
      sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium">
            {r.firstName} {r.lastName}
          </p>
          <p className="text-xs text-secondary">{r.email}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        if (r.lockedUntil && new Date(r.lockedUntil) > new Date())
          return <Badge variant="danger">Locked</Badge>;
        return (
          <Badge variant={r.isActive ? 'success' : 'default'}>
            {r.isActive ? 'Active' : 'Inactive'}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [
          { label: 'Reset Password', icon: KeyRound, onClick: () => openResetDialog(r) },
        ];
        return <ERPDropdownMenu items={items} />;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={tenant ? `Users — ${tenant.name}` : 'Manage Users'}
        subtitle="Reset a user's password on behalf of this tenant."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/tenants')}>
            <ArrowLeft className="h-4 w-4" /> Back to Tenants
          </Button>
        }
      />
      <div className="flex gap-3 mb-4">
        <Input
          aria-label="Search users"
          placeholder="Search name, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-36"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="locked">Locked</option>
        </Select>
      </div>

      <ERPDataGrid
        columns={columns}
        data={tenantUsers}
        isLoading={isLoading}
        rowKey="id"
        tableId="admin-tenant-users"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={`Reset password for ${resetTarget?.email ?? ''}`}
        size="sm"
      >
        <form onSubmit={handleSubmit((d) => resetMutation.mutate(d))} className="space-y-4">
          <p className="text-sm text-secondary">
            Confirm your own current password to reset this user&apos;s password. They will be
            signed out of all sessions.
          </p>
          <PasswordInput
            label="Your Current Password"
            autoComplete="current-password"
            {...register('currentPassword')}
            error={errors.currentPassword?.message}
          />
          <PasswordInput
            label="New Password"
            autoComplete="new-password"
            {...register('newPassword')}
            error={errors.newPassword?.message}
          />
          <PasswordInput
            label="Confirm New Password"
            autoComplete="new-password"
            {...register('confirmPassword')}
            error={errors.confirmPassword?.message}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting || resetMutation.isPending}>
              Reset Password
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
