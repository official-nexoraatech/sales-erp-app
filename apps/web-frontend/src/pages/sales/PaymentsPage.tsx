import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { XCircle } from 'lucide-react';
import { paymentApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Payment {
  id: number;
  paymentNumber: string;
  customerId: number;
  customerName?: string;
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

const STATUS_DESCRIPTIONS: Record<string, string> = {
  RECEIVED: 'Recorded, but not yet applied to any invoice.',
  PARTIALLY_ALLOCATED: 'Some of this payment is applied to an invoice; some is still unallocated.',
  FULLY_ALLOCATED: 'Fully applied to one or more invoices.',
  BOUNCED: 'Cheque bounced — the accounting entry was reversed automatically.',
  REFUNDED: 'Refunded to the customer.',
};

export default function PaymentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
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
    { key: 'customerName', header: 'Customer', render: (r) => r.customerName ?? r.customerId },
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
      render: (r) => (
        <Badge variant={STATUS_COLORS[r.status] ?? 'default'} title={STATUS_DESCRIPTIONS[r.status]}>
          {r.status}
        </Badge>
      ),
    },
  ];

  const rowActions: ERPRowAction<Payment>[] = [
    ...(canManagePayment
      ? [
          {
            label: 'Mark Bounced',
            icon: XCircle,
            type: 'delete' as const,
            onClick: async (r: Payment) => {
              const ok = await confirm({
                title: 'Mark cheque as bounced?',
                message: `This reverses the accounting entry for payment ${r.paymentNumber}. It does not automatically update any invoice this payment was applied to.`,
                confirmLabel: 'Mark Bounced',
                variant: 'danger',
              });
              if (ok) bounceMutation.mutate({ id: r.id, reason: 'Cheque bounced' });
            },
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
        subtitle="Record customer payments received against invoices"
      >
        {canManagePayment && (
          <Button
            data-tour-id="sales-payments-create-button"
            onClick={() => navigate('/sales/payments/new')}
          >
            + Record Payment
          </Button>
        )}
      </ERPPageHeader>

      <ERPDataGrid
        columns={columns}
        data={rows}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No payments recorded yet"
            description="Record a payment against a confirmed invoice, or start from an invoice's own 'Record Payment' button."
            {...(canManagePayment
              ? {
                  action: {
                    label: '+ Record Payment',
                    onClick: () => navigate('/sales/payments/new'),
                  },
                }
              : {})}
          />
        }
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
