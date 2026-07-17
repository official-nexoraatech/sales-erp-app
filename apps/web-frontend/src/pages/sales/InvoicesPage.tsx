import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, Copy, IndianRupee, Ban } from 'lucide-react';
import { invoiceApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Invoice {
  id: number;
  invoiceNumber: string | null;
  customerId: number;
  customerName?: string;
  status: string;
  grandTotal: string;
  balanceDue: string;
  invoiceDate: string;
  dueDate: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  CONFIRMED: 'success',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'danger',
  OVERDUE: 'danger',
};

export default function InvoicesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateInvoice = hasPermission(PERMISSIONS.INVOICE_CREATE);
  const canCreatePayment = hasPermission(PERMISSIONS.PAYMENT_CREATE);
  const canCancelInvoice = hasPermission(PERMISSIONS.INVOICE_CANCEL);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', debouncedSearch, status, page, pageSize],
    queryFn: () =>
      invoiceApi.list({
        search: debouncedSearch || undefined,
        status: status || undefined,
        page,
        pageSize,
      }),
    staleTime: 30_000,
  });

  const rows: Invoice[] = ((data as Record<string, unknown>)?.content as Invoice[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      invoiceApi.cancel(id, { reason }),
    onSuccess: () => {
      toast.success('Invoice cancelled');
      qc.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => invoiceApi.duplicate(id),
    onSuccess: (data: unknown) => {
      const result = data as { id?: number };
      if (result?.id) navigate(`/sales/invoices/${result.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Invoice>[] = [
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      mono: true,
      render: (r) =>
        r.invoiceNumber ? (
          <span className="font-mono text-sm">{r.invoiceNumber}</span>
        ) : (
          <span className="text-disabled text-sm italic">Draft</span>
        ),
    },
    { key: 'customerName', header: 'Customer', render: (r) => r.customerName ?? r.customerId },
    {
      key: 'grandTotal',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.grandTotal)),
    },
    {
      key: 'balanceDue',
      header: 'Balance Due',
      align: 'right',
      render: (r) => {
        const bal = parseFloat(r.balanceDue);
        return (
          <span className={bal > 0 ? 'text-danger font-semibold' : 'text-success'}>
            {formatCurrency(bal)}
          </span>
        );
      },
    },
    {
      key: 'invoiceDate',
      header: 'Date',
      sortable: true,
      render: (r) => formatDate(r.invoiceDate),
    },
    { key: 'dueDate', header: 'Due', render: (r) => formatDate(r.dueDate) },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<Invoice>[] = [
    {
      label: 'View',
      icon: Eye,
      type: 'view',
      onClick: (r: Invoice) => navigate(`/sales/invoices/${r.id}`),
    },
    ...(canCreateInvoice
      ? [
          {
            label: 'Duplicate',
            icon: Copy,
            type: 'duplicate' as const,
            onClick: (r: Invoice) => duplicateMutation.mutate(r.id),
          },
        ]
      : []),
    ...(canCreatePayment
      ? [
          {
            label: 'Record Payment',
            icon: IndianRupee,
            onClick: (r: Invoice) => navigate(`/sales/payments/new?invoiceId=${r.id}`),
            hidden: (r: Invoice) => !['CONFIRMED', 'PARTIALLY_PAID'].includes(r.status),
          },
        ]
      : []),
    ...(canCancelInvoice
      ? [
          {
            label: 'Cancel',
            icon: Ban,
            type: 'delete' as const,
            onClick: (r: Invoice) =>
              cancelMutation.mutate({ id: r.id, reason: 'Cancelled by user' }),
            hidden: (r: Invoice) => r.status !== 'DRAFT',
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Invoices" subtitle="Create and manage sales invoices">
        {canCreateInvoice && (
          <Button onClick={() => navigate('/sales/invoices/new')}>+ New Invoice</Button>
        )}
      </ERPPageHeader>

      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by invoice number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All Statuses</option>
          {['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

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
