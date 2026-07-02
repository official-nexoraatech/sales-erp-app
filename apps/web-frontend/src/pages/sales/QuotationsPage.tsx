import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { quotationApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Quotation {
  id: number;
  quotationNumber: string;
  customerId: number;
  status: string;
  grandTotal: string;
  validUntil: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SENT: 'warning',
  VIEWED: 'warning',
  ACCEPTED: 'success',
  CONVERTED: 'success',
  EXPIRED: 'danger',
  REJECTED: 'danger',
};

export default function QuotationsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', search, status],
    queryFn: () =>
      quotationApi.list({ ...(search ? { search } : {}), ...(status ? { status } : {}) }),
    staleTime: 30_000,
  });

  const rows: Quotation[] = (data as { data?: Quotation[] })?.data ?? [];

  const sendMutation = useMutation({
    mutationFn: (id: number) => quotationApi.send(id),
    onSuccess: () => { toast.success('Quotation sent'); qc.invalidateQueries({ queryKey: ['quotations'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => quotationApi.convert(id),
    onSuccess: (_data, id) => {
      toast.success('Quotation converted — creating invoice');
      navigate(`/sales/invoices/new?quotationId=${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    { key: 'quotationNumber', header: 'Number', className: 'font-mono text-sm' },
    { key: 'customerId', header: 'Customer' },
    {
      key: 'grandTotal',
      header: 'Total',
      render: (r: Quotation) => formatCurrency(parseFloat(r.grandTotal)),
    },
    {
      key: 'validUntil',
      header: 'Valid Until',
      render: (r: Quotation) => {
        const d = new Date(r.validUntil);
        const expired = d < new Date() && !['CONVERTED', 'EXPIRED', 'REJECTED'].includes(r.status);
        return <span className={expired ? 'text-red-600 font-medium' : ''}>{formatDate(d)}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: Quotation) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r: Quotation) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/quotations/${r.id}`)}>View</Button>
          {r.status === 'DRAFT' && (
            <Button size="sm" onClick={() => sendMutation.mutate(r.id)}>Send</Button>
          )}
          {['SENT', 'VIEWED', 'ACCEPTED'].includes(r.status) && (
            <Button size="sm" onClick={() => convertMutation.mutate(r.id)}>Convert</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Quotations" subtitle="Manage customer quotations">
        <Button onClick={() => navigate('/sales/quotations/new')}>+ New Quotation</Button>
      </ERPPageHeader>

      <div className="flex gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by number..."
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
          {['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'CONVERTED', 'EXPIRED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No quotations found" />
    </div>
  );
}
