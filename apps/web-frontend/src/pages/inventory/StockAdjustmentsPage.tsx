import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Send, CheckCircle2 } from 'lucide-react';
import { stockAdjustmentApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Adjustment {
  id: number;
  adjustmentNumber: string;
  adjustmentType: string;
  status: string;
  totalValue: string;
  createdAt: string;
  notes?: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  CANCELLED: 'danger',
};

export default function StockAdjustmentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-adjustments', status, page, pageSize],
    queryFn: () => stockAdjustmentApi.list({ status: status || undefined, page, limit: pageSize }),
  });

  const adjustments: Adjustment[] =
    ((data as Record<string, unknown>)?.content as Adjustment[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const approveMutation = useMutation({
    mutationFn: (id: number) => stockAdjustmentApi.approve(id),
    onSuccess: () => {
      toast.success('Adjustment approved — stock updated');
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => stockAdjustmentApi.submit(id),
    onSuccess: () => {
      toast.success('Adjustment submitted');
      qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Adjustment>[] = [
    { key: 'adjustmentNumber', header: 'Number', mono: true, sortable: true },
    {
      key: 'adjustmentType',
      header: 'Type',
      render: (r) => <Badge variant="default">{r.adjustmentType}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'totalValue',
      header: 'Value',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.totalValue)),
    },
    { key: 'createdAt', header: 'Date', sortable: true, render: (r) => formatDate(r.createdAt) },
  ];

  const rowActions: ERPRowAction<Adjustment>[] = [
    {
      label: 'Submit',
      icon: Send,
      onClick: (r: Adjustment) => submitMutation.mutate(r.id),
      hidden: (r: Adjustment) => r.status !== 'DRAFT',
    },
    {
      label: 'Approve',
      icon: CheckCircle2,
      onClick: (r: Adjustment) => approveMutation.mutate(r.id),
      hidden: (r: Adjustment) => !(r.status === 'SUBMITTED' || r.status === 'PENDING_APPROVAL'),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Stock Adjustments"
        subtitle="Record inventory discrepancies and corrections"
      >
        <Button onClick={() => navigate('/inventory/adjustments/new')}>+ New Adjustment</Button>
      </ERPPageHeader>

      <div className="mb-4 w-48">
        <Select
          label="Filter by Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'SUBMITTED', label: 'Submitted' },
            { value: 'PENDING_APPROVAL', label: 'Pending Approval' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
      </div>

      <ERPDataGrid
        columns={columns}
        data={adjustments}
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
