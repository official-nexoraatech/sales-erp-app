import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { stockAdjustmentApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

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

  const { data, isLoading } = useQuery({
    queryKey: ['stock-adjustments', status],
    queryFn: () => stockAdjustmentApi.list({ status: status || undefined }),
  });

  const adjustments: Adjustment[] = (data as { data?: Adjustment[] })?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: (id: number) => stockAdjustmentApi.approve(id),
    onSuccess: () => { toast.success('Adjustment approved — stock updated'); qc.invalidateQueries({ queryKey: ['stock-adjustments'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (id: number) => stockAdjustmentApi.submit(id),
    onSuccess: () => { toast.success('Adjustment submitted'); qc.invalidateQueries({ queryKey: ['stock-adjustments'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    { key: 'adjustmentNumber', header: 'Number', className: 'font-mono text-sm' },
    { key: 'adjustmentType', header: 'Type', render: (r: Adjustment) => <Badge variant="default">{r.adjustmentType}</Badge> },
    { key: 'status', header: 'Status', render: (r: Adjustment) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge> },
    { key: 'totalValue', header: 'Value', render: (r: Adjustment) => formatCurrency(parseFloat(r.totalValue)) },
    { key: 'createdAt', header: 'Date', render: (r: Adjustment) => formatDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      render: (r: Adjustment) => (
        <div className="flex gap-2">
          {r.status === 'DRAFT' && (
            <Button size="sm" onClick={() => submitMutation.mutate(r.id)}>Submit</Button>
          )}
          {(r.status === 'SUBMITTED' || r.status === 'PENDING_APPROVAL') && (
            <Button size="sm" variant="primary" onClick={() => approveMutation.mutate(r.id)}>Approve</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Stock Adjustments" subtitle="Record inventory discrepancies and corrections">
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

      <DataTable columns={columns} data={adjustments} isLoading={isLoading} emptyMessage="No adjustments found" />
    </div>
  );
}
