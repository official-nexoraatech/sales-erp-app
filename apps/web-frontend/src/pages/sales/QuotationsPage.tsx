import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, Send, ArrowRightLeft, Check, X } from 'lucide-react';
import { quotationApi } from '../../api/endpoints.js';
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
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateQuotation = hasPermission(PERMISSIONS.INVOICE_CREATE);
  const canConvertQuotation = hasPermission(PERMISSIONS.QUOTATION_CONVERT);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', debouncedSearch, status, page, pageSize],
    queryFn: () =>
      quotationApi.list({
        search: debouncedSearch || undefined,
        status: status || undefined,
        page,
        pageSize,
      }),
    staleTime: 30_000,
  });

  const rows: Quotation[] = ((data as Record<string, unknown>)?.content as Quotation[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const sendMutation = useMutation({
    mutationFn: (id: number) => quotationApi.send(id),
    onSuccess: () => {
      toast.success('Quotation sent');
      qc.invalidateQueries({ queryKey: ['quotations'] });
    },
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

  const acceptMutation = useMutation({
    mutationFn: (id: number) => quotationApi.accept(id),
    onSuccess: () => {
      toast.success('Quotation accepted');
      qc.invalidateQueries({ queryKey: ['quotations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => quotationApi.reject(id),
    onSuccess: () => {
      toast.success('Quotation rejected');
      qc.invalidateQueries({ queryKey: ['quotations'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Quotation>[] = [
    { key: 'quotationNumber', header: 'Number', mono: true, sortable: true },
    { key: 'customerId', header: 'Customer' },
    {
      key: 'grandTotal',
      header: 'Total',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.grandTotal)),
    },
    {
      key: 'validUntil',
      header: 'Valid Until',
      sortable: true,
      render: (r) => {
        const d = new Date(r.validUntil);
        const expired = d < new Date() && !['CONVERTED', 'EXPIRED', 'REJECTED'].includes(r.status);
        return <span className={expired ? 'text-danger font-medium' : ''}>{formatDate(d)}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<Quotation>[] = [
    {
      label: 'View',
      icon: Eye,
      type: 'view',
      onClick: (r: Quotation) => navigate(`/sales/quotations/${r.id}`),
    },
    ...(canCreateQuotation
      ? [
          {
            label: 'Send',
            icon: Send,
            onClick: (r: Quotation) => sendMutation.mutate(r.id),
            hidden: (r: Quotation) => r.status !== 'DRAFT',
          },
        ]
      : []),
    ...(canConvertQuotation
      ? [
          {
            label: 'Accept',
            icon: Check,
            onClick: (r: Quotation) => acceptMutation.mutate(r.id),
            hidden: (r: Quotation) => !['SENT', 'VIEWED'].includes(r.status),
          },
        ]
      : []),
    ...(canConvertQuotation
      ? [
          {
            label: 'Reject',
            icon: X,
            type: 'delete' as const,
            onClick: (r: Quotation) => rejectMutation.mutate(r.id),
            hidden: (r: Quotation) => !['SENT', 'VIEWED'].includes(r.status),
          },
        ]
      : []),
    ...(canConvertQuotation
      ? [
          {
            label: 'Convert to Invoice',
            icon: ArrowRightLeft,
            onClick: (r: Quotation) => convertMutation.mutate(r.id),
            hidden: (r: Quotation) => r.status !== 'ACCEPTED',
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Quotations" subtitle="Manage customer quotations">
        {canCreateQuotation && (
          <Button onClick={() => navigate('/sales/quotations/new')}>+ New Quotation</Button>
        )}
      </ERPPageHeader>

      <div className="flex flex-col sm:flex-row gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All Statuses</option>
          {['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'CONVERTED', 'EXPIRED', 'REJECTED'].map((s) => (
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
