import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Eye, Send, CheckCircle2, Truck, PackageCheck } from 'lucide-react';
import { stockTransferApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Select from '../../components/ui/Select.js';
import Input from '../../components/ui/Input.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { formatDate } from '../../lib/format.js';

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
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfers', status, debouncedSearch, page, pageSize],
    queryFn: () =>
      stockTransferApi.list({
        status: status || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: pageSize,
      }),
  });

  const transfers: Transfer[] = ((data as Record<string, unknown>)?.content as Transfer[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  // A transfer is created as DRAFT (see StockTransferService.create) and the backend already
  // exposes POST /stock-transfers/:id/submit (stockTransferApi.submit) to move it to SUBMITTED
  // — but until this fix, no page anywhere in the app ever called it, so every transfer was
  // permanently stuck in DRAFT (Approve only ever appears for SUBMITTED). Found via live E2E.
  const submitMutation = useMutation({
    mutationFn: (id: number) => stockTransferApi.submit(id),
    onSuccess: () => {
      toast.success('Transfer submitted for approval');
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => stockTransferApi.approve(id),
    onSuccess: () => {
      toast.success('Transfer approved');
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const dispatchMutation = useMutation({
    mutationFn: (id: number) => stockTransferApi.dispatch(id),
    onSuccess: () => {
      toast.success('Transfer dispatched');
      qc.invalidateQueries({ queryKey: ['stock-transfers'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Transfer>[] = [
    { key: 'transferNumber', header: 'Transfer #', mono: true, sortable: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    { key: 'notes', header: 'Notes', render: (r) => r.notes ?? '–' },
    { key: 'createdAt', header: 'Created', sortable: true, render: (r) => formatDate(r.createdAt) },
  ];

  const rowActions: ERPRowAction<Transfer>[] = [
    {
      label: 'View',
      icon: Eye,
      type: 'view',
      onClick: (r: Transfer) => navigate(`/inventory/transfers/${r.id}`),
    },
    {
      label: 'Submit',
      icon: Send,
      onClick: (r: Transfer) => submitMutation.mutate(r.id),
      hidden: (r: Transfer) => r.status !== 'DRAFT',
    },
    {
      label: 'Approve',
      icon: CheckCircle2,
      onClick: (r: Transfer) => approveMutation.mutate(r.id),
      hidden: (r: Transfer) => r.status !== 'SUBMITTED',
    },
    {
      label: 'Dispatch',
      icon: Truck,
      onClick: (r: Transfer) => dispatchMutation.mutate(r.id),
      hidden: (r: Transfer) => r.status !== 'APPROVED',
    },
    {
      label: 'Receive',
      icon: PackageCheck,
      onClick: (r: Transfer) => navigate(`/inventory/transfers/${r.id}/receive`),
      hidden: (r: Transfer) => !(r.status === 'DISPATCHED' || r.status === 'IN_TRANSIT'),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Stock Transfers"
        subtitle="Move stock between warehouses"
      >
        <Button onClick={() => navigate('/inventory/transfers/new')}>+ New Transfer</Button>
      </ERPPageHeader>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by transfer number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          label="Filter by Status"
          wrapperClassName="w-48"
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

      <ERPDataGrid
        columns={columns}
        data={transfers}
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
