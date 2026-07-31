import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Send, CheckCircle2, Eye, XCircle } from 'lucide-react';
import { stockAdjustmentApi } from '../../api/endpoints.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
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

const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: 'Saved but not submitted — stock is unaffected.',
  SUBMITTED: 'Awaiting approval — stock is still unaffected until approved.',
  PENDING_APPROVAL:
    'Over ₹50,000 in value, so it needs approval before it applies (same as SUBMITTED otherwise).',
  APPROVED: 'Applied — stock quantity has been updated. This does not recompute your average cost.',
  CANCELLED: 'Cancelled before approval — never applied to stock.',
};

export default function StockAdjustmentsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
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

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      stockAdjustmentApi.cancel(id, reason),
    onSuccess: () => {
      toast.success('Adjustment cancelled');
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
      render: (r) => (
        <Badge variant={STATUS_COLORS[r.status] ?? 'default'} title={STATUS_DESCRIPTIONS[r.status]}>
          {r.status}
        </Badge>
      ),
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
      label: 'View',
      icon: Eye,
      tourId: 'inventory-adjustments-view-button',
      onClick: (r: Adjustment) => navigate(`/inventory/adjustments/${r.id}`),
    },
    {
      label: 'Submit',
      icon: Send,
      tourId: 'inventory-adjustments-submit-button',
      onClick: (r: Adjustment) => submitMutation.mutate(r.id),
      hidden: (r: Adjustment) => r.status !== 'DRAFT',
    },
    {
      label: 'Approve',
      icon: CheckCircle2,
      tourId: 'inventory-adjustments-approve-button',
      onClick: async (r: Adjustment) => {
        const ok = await confirm({
          title: 'Approve this adjustment?',
          message: `This immediately updates stock quantity for every line on ${r.adjustmentNumber}. It does not recompute average cost, and there's no undo — cannot be cancelled once approved.`,
          confirmLabel: 'Approve',
          variant: 'primary',
        });
        if (ok) approveMutation.mutate(r.id);
      },
      hidden: (r: Adjustment) => !(r.status === 'SUBMITTED' || r.status === 'PENDING_APPROVAL'),
    },
    {
      label: 'Cancel',
      icon: XCircle,
      tourId: 'inventory-adjustments-cancel-button',
      onClick: (r: Adjustment) => {
        const reason = window.prompt('Reason for cancelling this adjustment:');
        if (reason && reason.trim()) cancelMutation.mutate({ id: r.id, reason: reason.trim() });
      },
      hidden: (r: Adjustment) => ['APPROVED', 'CANCELLED'].includes(r.status),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Stock Adjustments"
        subtitle="Record inventory discrepancies and corrections"
      >
        <Button
          data-tour-id="inventory-adjustments-create-button"
          onClick={() => navigate('/inventory/adjustments/new')}
        >
          + New Adjustment
        </Button>
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
        emptyState={
          status ? (
            <ERPEmptyState type="no-results" />
          ) : (
            <ERPEmptyState
              type="no-data"
              title="No adjustments yet"
              description="Record a stock adjustment to correct damage, wastage, theft, or a count discrepancy."
              action={{
                label: '+ New Adjustment',
                onClick: () => navigate('/inventory/adjustments/new'),
              }}
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
