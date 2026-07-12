import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Ban, CheckCircle, XCircle, Users } from 'lucide-react';
import { adminTenantApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';

interface Tenant {
  id: number;
  name: string;
  slug: string;
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  plan: 'STARTER' | 'GROWTH' | 'ENTERPRISE';
  contactEmail: string;
  createdAt: string;
}

const STATUS_VARIANT: Record<Tenant['status'], 'success' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  PROVISIONING: 'warning',
  SUSPENDED: 'danger',
  CLOSED: 'default',
};

interface ReasonForm {
  reason: string;
}

export default function TenantsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = useAuthStore((s) => s.hasPermission(PERMISSIONS.PLATFORM_TENANT_MANAGE));
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: () => adminTenantApi.list(),
  });
  const tenantsList: Tenant[] = (data as { content?: Tenant[] })?.content ?? [];

  const [dialog, setDialog] = useState<{ mode: 'suspend' | 'close'; tenant: Tenant } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ReasonForm>();

  const activateMutation = useMutation({
    mutationFn: (id: number) => adminTenantApi.activate(id),
    onSuccess: () => {
      toast.success('Tenant activated');
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reasonMutation = useMutation({
    mutationFn: (d: ReasonForm) =>
      dialog!.mode === 'suspend'
        ? adminTenantApi.suspend(dialog!.tenant.id, d.reason)
        : adminTenantApi.close(dialog!.tenant.id, d.reason),
    onSuccess: () => {
      toast.success(dialog!.mode === 'suspend' ? 'Tenant suspended' : 'Tenant closed');
      qc.invalidateQueries({ queryKey: ['admin-tenants'] });
      setDialog(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openReasonDialog(mode: 'suspend' | 'close', tenant: Tenant): void {
    reset({ reason: '' });
    setDialog({ mode, tenant });
  }

  const columns: ERPColumnDef<Tenant>[] = [
    { key: 'id', header: 'Tenant ID', mono: true },
    { key: 'name', header: 'Organization', sortable: true },
    { key: 'slug', header: 'Slug', mono: true, sortable: true },
    { key: 'contactEmail', header: 'Contact Email' },
    { key: 'plan', header: 'Plan' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        if (!canManage) return null;
        const items: ERPMenuItem[] = [];
        items.push({
          label: 'Manage Users',
          icon: Users,
          onClick: () => navigate(`/admin/tenants/${r.id}/users`),
        });
        if (r.status === 'ACTIVE') {
          items.push({
            label: 'Suspend',
            icon: Ban,
            variant: 'danger',
            onClick: () => openReasonDialog('suspend', r),
          });
        }
        if (r.status === 'SUSPENDED') {
          items.push({
            label: 'Activate',
            icon: CheckCircle,
            onClick: () => activateMutation.mutate(r.id),
          });
        }
        if (r.status !== 'CLOSED') {
          items.push({
            label: 'Close',
            icon: XCircle,
            variant: 'danger',
            onClick: () => openReasonDialog('close', r),
          });
        }
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Tenants"
        subtitle="Manage every organization provisioned on this platform."
        actions={
          canManage ? (
            <Button onClick={() => navigate('/admin/tenants/new')}>+ New Tenant</Button>
          ) : undefined
        }
      />
      <ERPDataGrid columns={columns} data={tenantsList} isLoading={isLoading} rowKey="id" />

      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === 'suspend'
            ? `Suspend ${dialog.tenant.name}`
            : `Close ${dialog?.tenant.name ?? ''}`
        }
        size="sm"
      >
        <form onSubmit={handleSubmit((d) => reasonMutation.mutate(d))} className="space-y-4">
          <Input
            label="Reason"
            required
            placeholder="Minimum 5 characters"
            {...register('reason', {
              required: 'Required',
              minLength: { value: 5, message: 'At least 5 characters' },
            })}
            error={errors.reason?.message}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={isSubmitting || reasonMutation.isPending}
            >
              {dialog?.mode === 'suspend' ? 'Suspend' : 'Close Tenant'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
