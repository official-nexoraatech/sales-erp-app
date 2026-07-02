import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { stockTransferApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Transfer {
  id: number;
  transferNumber: string;
  fromWarehouseId: number;
  toWarehouseId: number;
  status: string;
  notes?: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  DISPATCHED: 'warning',
  IN_TRANSIT: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

export default function StockTransfersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfers', status],
    queryFn: () => stockTransferApi.list({ status: status || undefined }),
  });

  const transfers: Transfer[] = (data as { data?: Transfer[] })?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: (id: number) => stockTransferApi.approve(id),
    onSuccess: () => { toast.success('Transfer approved'); qc.invalidateQueries({ queryKey: ['stock-transfers'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatchMutation = useMutation({
    mutationFn: (id: number) => stockTransferApi.dispatch(id),
    onSuccess: () => { toast.success('Transfer dispatched'); qc.invalidateQueries({ queryKey: ['stock-transfers'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    { key: 'transferNumber', header: 'Transfer #', className: 'font-mono text-sm' },
    {
      key: 'status',
      header: 'Status',
      render: (r: Transfer) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    { key: 'notes', header: 'Notes', render: (r: Transfer) => r.notes ?? '–' },
    { key: 'createdAt', header: 'Created', render: (r: Transfer) => formatDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      render: (r: Transfer) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/inventory/transfers/${r.id}`)}>
            View
          </Button>
          {r.status === 'SUBMITTED' && (
            <Button size="sm" onClick={() => approveMutation.mutate(r.id)}>Approve</Button>
          )}
          {r.status === 'APPROVED' && (
            <Button size="sm" onClick={() => dispatchMutation.mutate(r.id)}>Dispatch</Button>
          )}
          {(r.status === 'DISPATCHED' || r.status === 'IN_TRANSIT') && (
            <Button size="sm" variant="primary" onClick={() => navigate(`/inventory/transfers/${r.id}/receive`)}>
              Receive
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Stock Transfers" subtitle="Move stock between warehouses">
        <Button onClick={() => navigate('/inventory/transfers/new')}>+ New Transfer</Button>
      </ERPPageHeader>

      <div className="mb-4 w-48">
        <Select
          label="Filter by Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'SUBMITTED', label: 'Submitted' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'DISPATCHED', label: 'Dispatched' },
            { value: 'IN_TRANSIT', label: 'In Transit' },
            { value: 'RECEIVED', label: 'Received' },
            { value: 'CANCELLED', label: 'Cancelled' },
          ]}
        />
      </div>

      <DataTable columns={columns} data={transfers} isLoading={isLoading} emptyMessage="No transfers found" />
    </div>
  );
}
