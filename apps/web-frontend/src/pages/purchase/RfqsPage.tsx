import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { rfqApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatDate } from '../../lib/format.js';

interface Rfq {
  id: number;
  rfqNumber: string | null;
  status: string;
  dueDate: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SENT: 'warning',
  CLOSED: 'success',
  CANCELLED: 'danger',
};

export default function RfqsPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.RFQ_CREATE);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading } = useQuery({
    queryKey: ['rfqs', status],
    queryFn: () => rfqApi.list({ status: status || undefined }),
    staleTime: 30_000,
  });

  const rows: Rfq[] = ((data as Record<string, unknown>)?.content as Rfq[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? rows.length;

  const columns: ERPColumnDef<Rfq>[] = [
    { key: 'rfqNumber', header: 'RFQ #', mono: true, render: (r) => r.rfqNumber ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'dueDate',
      header: 'Due Date',
      render: (r) => (r.dueDate ? formatDate(r.dueDate) : '—'),
    },
    { key: 'createdAt', header: 'Created', render: (r) => formatDate(r.createdAt) },
  ];

  const rowActions: ERPRowAction<Rfq>[] = [
    {
      label: 'Compare Quotations',
      icon: Eye,
      type: 'view',
      onClick: (r: Rfq) => navigate(`/purchase/rfqs/${r.id}`),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Request For Quotation (RFQ)"
        subtitle="Solicit and compare supplier quotations"
      >
        {canCreate && <Button onClick={() => navigate('/purchase/rfqs/new')}>+ New RFQ</Button>}
      </ERPPageHeader>

      <div className="flex flex-wrap gap-4 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All Statuses</option>
          {['DRAFT', 'SENT', 'CLOSED', 'CANCELLED'].map((s) => (
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
        emptyState={
          status ? (
            <ERPEmptyState type="no-results" />
          ) : (
            <ERPEmptyState
              type="no-data"
              title="No RFQs yet"
              description="Create an RFQ to solicit quotations from multiple suppliers and compare them."
              {...(canCreate
                ? { action: { label: '+ New RFQ', onClick: () => navigate('/purchase/rfqs/new') } }
                : {})}
            />
          )
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
