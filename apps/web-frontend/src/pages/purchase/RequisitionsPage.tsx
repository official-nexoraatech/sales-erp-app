import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, Send, CheckCircle2, XCircle, ArrowRightCircle } from 'lucide-react';
import { requisitionApi } from '../../api/endpoints.js';
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
import Input from '../../components/ui/Input.js';
import Modal from '../../components/ui/Modal.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface Requisition {
  id: number;
  requisitionNumber: string | null;
  department: string | null;
  priority: string;
  status: string;
  estimatedTotal: string;
  requiredByDate: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CONVERTED: 'success',
  CANCELLED: 'danger',
};

export default function RequisitionsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.REQUISITION_CREATE);
  const canApprove = hasPermission(PERMISSIONS.REQUISITION_APPROVE);
  const canConvert = hasPermission(PERMISSIONS.REQUISITION_CONVERT);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading } = useQuery({
    queryKey: ['requisitions', status],
    queryFn: () => requisitionApi.list({ status: status || undefined }),
    staleTime: 30_000,
  });

  const rows: Requisition[] = ((data as Record<string, unknown>)?.content as Requisition[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? rows.length;

  const submitMutation = useMutation({
    mutationFn: (id: number) => requisitionApi.submit(id),
    onSuccess: () => {
      toast.success('Requisition submitted for approval');
      qc.invalidateQueries({ queryKey: ['requisitions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => requisitionApi.approve(id),
    onSuccess: () => {
      toast.success('Requisition approved');
      qc.invalidateQueries({ queryKey: ['requisitions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      requisitionApi.reject(id, { reason }),
    onSuccess: () => {
      toast.success('Requisition rejected');
      setRejectId(null);
      setRejectReason('');
      qc.invalidateQueries({ queryKey: ['requisitions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Requisition>[] = [
    {
      key: 'requisitionNumber',
      header: 'Requisition #',
      mono: true,
      render: (r) => r.requisitionNumber ?? '—',
    },
    { key: 'department', header: 'Department', render: (r) => r.department ?? '—' },
    {
      key: 'priority',
      header: 'Priority',
      render: (r) => (
        <Badge variant={r.priority === 'URGENT' || r.priority === 'HIGH' ? 'warning' : 'default'}>
          {r.priority}
        </Badge>
      ),
    },
    {
      key: 'estimatedTotal',
      header: 'Est. Total',
      align: 'right',
      render: (r) => formatCurrency(parseFloat(r.estimatedTotal)),
    },
    {
      key: 'requiredByDate',
      header: 'Required By',
      render: (r) => (r.requiredByDate ? formatDate(r.requiredByDate) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<Requisition>[] = [
    {
      label: 'View',
      icon: Eye,
      type: 'view',
      onClick: (r: Requisition) => navigate(`/purchase/requisitions/${r.id}`),
    },
    ...(canCreate
      ? [
          {
            label: 'Submit',
            icon: Send,
            onClick: (r: Requisition) => submitMutation.mutate(r.id),
            hidden: (r: Requisition) => r.status !== 'DRAFT',
          },
        ]
      : []),
    ...(canApprove
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            onClick: (r: Requisition) => approveMutation.mutate(r.id),
            hidden: (r: Requisition) => r.status !== 'SUBMITTED',
          },
          {
            label: 'Reject',
            icon: XCircle,
            type: 'delete' as const,
            onClick: (r: Requisition) => {
              setRejectId(r.id);
              setRejectReason('');
            },
            hidden: (r: Requisition) => r.status !== 'SUBMITTED',
          },
        ]
      : []),
    ...(canConvert
      ? [
          {
            label: 'Convert to PO',
            icon: ArrowRightCircle,
            onClick: (r: Requisition) => navigate(`/purchase/requisitions/${r.id}`),
            hidden: (r: Requisition) => r.status !== 'APPROVED',
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Purchase Requisitions"
        subtitle="Department requests, upstream of RFQ/PO"
      >
        {canCreate && (
          <Button onClick={() => navigate('/purchase/requisitions/new')}>+ New Requisition</Button>
        )}
      </ERPPageHeader>

      <div className="flex flex-wrap gap-4 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All Statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'].map((s) => (
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
              title="No requisitions yet"
              description="Raise a requisition to request goods before creating an RFQ or Purchase Order."
              {...(canCreate
                ? {
                    action: {
                      label: '+ New Requisition',
                      onClick: () => navigate('/purchase/requisitions/new'),
                    },
                  }
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

      <Modal
        isOpen={rejectId !== null}
        onClose={() => setRejectId(null)}
        title="Reject Requisition"
      >
        <div className="space-y-4">
          <Input
            label="Reason"
            required
            placeholder="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectId(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={rejectMutation.isPending}
              disabled={!rejectReason.trim()}
              onClick={() =>
                rejectId !== null && rejectMutation.mutate({ id: rejectId, reason: rejectReason })
              }
            >
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
