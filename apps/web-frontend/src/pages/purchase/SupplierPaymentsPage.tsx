import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { XCircle } from 'lucide-react';
import { supplierPaymentApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface SupplierPayment {
  id: number;
  paymentNumber: string;
  supplierId: number;
  paymentDate: string;
  paymentMode: string;
  amount: string;
  unallocatedAmount: string;
  status: string;
  isPdc: boolean;
  pdcClearingDate: string | null;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  PAID: 'warning',
  PARTIALLY_ALLOCATED: 'warning',
  FULLY_ALLOCATED: 'success',
  BOUNCED: 'danger',
};

export default function SupplierPaymentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canManagePayment = useAuthStore((s) => s.hasPermission(PERMISSIONS.PAYMENT_OUT_CREATE));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier-payments', page, pageSize],
    queryFn: () => supplierPaymentApi.list({ page, pageSize }),
    staleTime: 30_000,
  });

  const rows: SupplierPayment[] =
    ((data as Record<string, unknown>)?.content as SupplierPayment[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const bounceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      supplierPaymentApi.bounce(id, { reason }),
    onSuccess: () => {
      toast.success('Cheque marked bounced');
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<SupplierPayment>[] = [
    { key: 'paymentNumber', header: 'Number', mono: true },
    { key: 'supplierId', header: 'Supplier' },
    {
      key: 'paymentMode',
      header: 'Mode',
      render: (r) => (
        <span>
          {r.paymentMode}
          {r.isPdc && (
            <span className="ml-1">
              <Badge variant="warning">PDC</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.amount)),
    },
    {
      key: 'unallocatedAmount',
      header: 'Unallocated',
      align: 'right',
      render: (r) => {
        const u = parseFloat(r.unallocatedAmount);
        return (
          <span className={u > 0 ? 'text-warning font-medium' : 'text-secondary'}>
            {formatCurrency(u)}
          </span>
        );
      },
    },
    {
      key: 'paymentDate',
      header: 'Date',
      sortable: true,
      render: (r) => formatDate(r.paymentDate),
    },
    {
      key: 'pdcClearingDate',
      header: 'PDC Clearing',
      render: (r) => (r.pdcClearingDate ? formatDate(r.pdcClearingDate) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status.replace('_', ' ')}</Badge>
      ),
    },
  ];

  const rowActions: ERPRowAction<SupplierPayment>[] = [
    ...(canManagePayment
      ? [
          {
            label: 'Mark Bounced',
            icon: XCircle,
            type: 'delete' as const,
            onClick: (r: SupplierPayment) =>
              bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' }),
            hidden: (r: SupplierPayment) =>
              !(r.paymentMode === 'CHEQUE' && ['PAID', 'PARTIALLY_ALLOCATED'].includes(r.status)),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Supplier Payments"
        subtitle="Record and track payments to suppliers"
      >
        {canManagePayment && (
          <Button onClick={() => navigate('/purchase/payments/new')}>+ Record Payment</Button>
        )}
      </ERPPageHeader>

      <ERPDataGrid
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        actions={rowActions}
      />
    </div>
  );
}
