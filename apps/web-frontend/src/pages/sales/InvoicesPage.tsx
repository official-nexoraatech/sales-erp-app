import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { invoiceApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Invoice {
  id: number;
  invoiceNumber: string | null;
  customerId: number;
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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, status],
    queryFn: () =>
      invoiceApi.list({ ...(search ? { search } : {}), ...(status ? { status } : {}) }),
    staleTime: 30_000,
  });

  const rows: Invoice[] = (data as { data?: Invoice[] })?.data ?? [];

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      invoiceApi.cancel(id, { reason }),
    onSuccess: () => { toast.success('Invoice cancelled'); qc.invalidateQueries({ queryKey: ['invoices'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => invoiceApi.duplicate(id),
    onSuccess: (data: unknown, id) => {
      const result = data as { data?: { id?: number } };
      if (result?.data?.id) navigate(`/sales/invoices/${result.data.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    {
      key: 'invoiceNumber',
      header: 'Invoice #',
      render: (r: Invoice) => r.invoiceNumber
        ? <span className="font-mono text-sm">{r.invoiceNumber}</span>
        : <span className="text-gray-400 text-sm italic">Draft</span>,
    },
    { key: 'customerId', header: 'Customer' },
    {
      key: 'grandTotal',
      header: 'Amount',
      render: (r: Invoice) => formatCurrency(parseFloat(r.grandTotal)),
    },
    {
      key: 'balanceDue',
      header: 'Balance Due',
      render: (r: Invoice) => {
        const bal = parseFloat(r.balanceDue);
        return <span className={bal > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
          {formatCurrency(bal)}
        </span>;
      },
    },
    { key: 'invoiceDate', header: 'Date', render: (r: Invoice) => formatDate(r.invoiceDate) },
    { key: 'dueDate', header: 'Due', render: (r: Invoice) => formatDate(r.dueDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r: Invoice) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r: Invoice) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/invoices/${r.id}`)}>View</Button>
          <Button size="sm" variant="ghost" onClick={() => duplicateMutation.mutate(r.id)}>Copy</Button>
          {['CONFIRMED', 'PARTIALLY_PAID'].includes(r.status) && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/payments/new?invoiceId=${r.id}`)}>
              Pay
            </Button>
          )}
          {r.status === 'DRAFT' && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => cancelMutation.mutate({ id: r.id, reason: 'Cancelled by user' })}
            >
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Invoices" subtitle="Create and manage sales invoices">
        <Button onClick={() => navigate('/sales/invoices/new')}>+ New Invoice</Button>
      </ERPPageHeader>

      <div className="flex gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by invoice number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm px-3 py-2"
        >
          <option value="">All Statuses</option>
          {['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No invoices found" />
    </div>
  );
}
