import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { adminTenantApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPUsageMeter from '../../components/erp/ERPUsageMeter.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';

interface TenantInvoice {
  id: number;
  amountPaise: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'VOID';
  billingPeriodStart: string;
  billingPeriodEnd: string;
  failureReason?: string | null;
}

const PLAN_OPTIONS: Array<'STARTER' | 'GROWTH' | 'ENTERPRISE'> = [
  'STARTER',
  'GROWTH',
  'ENTERPRISE',
];

export default function AdminTenantBillingPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const id = Number(tenantId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPermission(PERMISSIONS.PLATFORM_TENANT_MANAGE));

  const { data: tenant } = useQuery({
    queryKey: ['admin-tenant', id],
    queryFn: () => adminTenantApi.getById(id),
  });

  const { data: billing, isLoading: billingLoading } = useQuery({
    queryKey: ['admin-tenant-billing', id],
    queryFn: () => adminTenantApi.getBilling(id),
  });

  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['admin-tenant-invoices', id],
    queryFn: () => adminTenantApi.listInvoices(id),
  });
  const invoices: TenantInvoice[] = (invoicesData as { content?: TenantInvoice[] })?.content ?? [];

  const [selectedPlan, setSelectedPlan] = useState<'STARTER' | 'GROWTH' | 'ENTERPRISE' | ''>('');

  const changePlanMutation = useMutation({
    mutationFn: (plan: 'STARTER' | 'GROWTH' | 'ENTERPRISE') => adminTenantApi.updatePlan(id, plan),
    onSuccess: () => {
      toast.success('Plan updated');
      setSelectedPlan('');
      qc.invalidateQueries({ queryKey: ['admin-tenant-billing', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const retryMutation = useMutation({
    mutationFn: (invoiceId: number) => adminTenantApi.retryInvoicePayment(id, invoiceId),
    onSuccess: (result) => {
      if (result.status === 'PAID') {
        toast.success('Payment succeeded');
      } else {
        toast.error('Payment retry failed — check the invoice for details');
      }
      qc.invalidateQueries({ queryKey: ['admin-tenant-invoices', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<TenantInvoice>[] = [
    { key: 'id', header: 'Invoice #', mono: true },
    {
      key: 'amountPaise',
      header: 'Amount',
      render: (r) => `${r.currency} ${(r.amountPaise / 100).toFixed(2)}`,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const variant =
          r.status === 'PAID' ? 'success' : r.status === 'FAILED' ? 'danger' : 'default';
        return <Badge variant={variant}>{r.status}</Badge>;
      },
    },
    {
      key: 'billingPeriodStart',
      header: 'Period',
      render: (r) => `${r.billingPeriodStart} – ${r.billingPeriodEnd}`,
    },
    { key: 'failureReason', header: 'Failure Reason', render: (r) => r.failureReason ?? '—' },
  ];

  const rowActions: ERPRowAction<TenantInvoice>[] = canManage
    ? [
        {
          icon: RefreshCw,
          label: 'Retry Payment',
          onClick: (r) => retryMutation.mutate(r.id),
          hidden: (r) => r.status === 'PAID',
        },
      ]
    : [];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title={tenant ? `Billing — ${tenant.name}` : 'Tenant Billing'}
        subtitle="Plan, entitlement usage, and invoice history for this tenant."
        actions={
          <Button variant="secondary" onClick={() => navigate('/admin/tenants')}>
            <ArrowLeft className="h-4 w-4" /> Back to Tenants
          </Button>
        }
      />

      {billing && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <Badge variant="default">{billing.plan}</Badge>
            {canManage && (
              <div className="flex items-center gap-2">
                <Select
                  aria-label="Change plan"
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value as typeof selectedPlan)}
                  className="w-40"
                >
                  <option value="">Change plan…</option>
                  {PLAN_OPTIONS.filter((p) => p !== billing.plan).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  disabled={!selectedPlan || changePlanMutation.isPending}
                  onClick={() => selectedPlan && changePlanMutation.mutate(selectedPlan)}
                >
                  Confirm
                </Button>
              </div>
            )}
            {billing.nextBillingDate && (
              <p className="text-xs text-secondary">Next billing: {billing.nextBillingDate}</p>
            )}
            {billing.dunningStartedAt && (
              <Badge variant="danger">
                Dunning since {new Date(billing.dunningStartedAt).toLocaleDateString()}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6 max-w-xl">
            <ERPUsageMeter
              label="Users"
              current={billing.entitlements.currentUsers}
              max={billing.entitlements.maxUsers}
            />
            <ERPUsageMeter
              label="Branches"
              current={billing.entitlements.currentBranches}
              max={billing.entitlements.maxBranches}
            />
          </div>
        </>
      )}

      <ERPDataGrid
        columns={columns}
        data={invoices}
        isLoading={billingLoading || invoicesLoading}
        rowKey="id"
        tableId="admin-tenant-invoices"
        actions={rowActions}
      />
    </div>
  );
}
