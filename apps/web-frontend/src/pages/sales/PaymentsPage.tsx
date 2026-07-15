import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Split, XCircle } from 'lucide-react';
import { paymentApi } from '../../api/endpoints.js';
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

interface Payment {
  id: number;
  paymentNumber: string;
  customerId: number;
  paymentDate: string;
  paymentMode: string;
  amount: string;
  unallocatedAmount: string;
  status: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  RECEIVED: 'warning',
  PARTIALLY_ALLOCATED: 'warning',
  FULLY_ALLOCATED: 'success',
  BOUNCED: 'danger',
  REFUNDED: 'default',
};

export default function PaymentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManagePayment = hasPermission(PERMISSIONS.PAYMENT_CREATE);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['payments', page, pageSize],
    queryFn: () => paymentApi.list({ page, pageSize }),
    staleTime: 30_000,
  });

  const rows: Payment[] = ((data as Record<string, unknown>)?.content as Payment[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const bounceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      paymentApi.bounceCheque(id, { reason }),
    onSuccess: () => {
      toast.success('Cheque marked bounced');
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Payment>[] = [
    { key: 'paymentNumber', header: 'Number', mono: true },
    { key: 'customerId', header: 'Customer' },
    { key: 'paymentMode', header: 'Mode' },
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
          <span className={u > 0 ? 'text-warning font-medium' : 'text-disabled'}>
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
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<Payment>[] = [
    ...(canManagePayment
      ? [
          {
            label: 'Allocate',
            icon: Split,
            onClick: (r: Payment) => navigate(`/sales/payments/${r.id}/allocate`),
            hidden: (r: Payment) => !(parseFloat(r.unallocatedAmount) > 0),
          },
        ]
      : []),
    ...(canManagePayment
      ? [
          {
            label: 'Mark Bounced',
            icon: XCircle,
            type: 'delete' as const,
            onClick: (r: Payment) => bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' }),
            hidden: (r: Payment) => !(r.paymentMode === 'CHEQUE' && r.status === 'RECEIVED'),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Payments"
        subtitle="Record and allocate customer payments"
      >
        {canManagePayment && (
          <Button onClick={() => navigate('/sales/payments/new')}>+ Record Payment</Button>
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
