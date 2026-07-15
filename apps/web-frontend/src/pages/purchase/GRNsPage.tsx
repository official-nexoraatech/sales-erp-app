import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, XCircle, Paperclip } from 'lucide-react';
import { grnApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPDrawer from '../../components/erp/ERPDrawer.js';
import AttachmentSection from '../../components/erp/AttachmentSection.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface GRN {
  id: number;
  grnNumber: string | null;
  supplierId: number;
  purchaseOrderId: number;
  status: string;
  grandTotal: string;
  hasPriceVariance: boolean;
  receivedDate: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export default function GRNsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateGRN = hasPermission(PERMISSIONS.GRN_CREATE);
  const canApproveGRN = hasPermission(PERMISSIONS.GRN_APPROVE);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [approveId, setApproveId] = useState<number | null>(null);
  const [grnNumber, setGrnNumber] = useState('');
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [attachmentsForId, setAttachmentsForId] = useState<number | null>(null);

  useEffect(() => {
    setPage(1);
  }, [status, debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['grns', status, debouncedSearch, page, pageSize],
    queryFn: () =>
      grnApi.list({
        status: status || undefined,
        search: debouncedSearch || undefined,
        page,
        pageSize,
      }),
    staleTime: 30_000,
  });

  const rows: GRN[] = ((data as Record<string, unknown>)?.content as GRN[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const approveMutation = useMutation({
    mutationFn: ({ id, num }: { id: number; num: string }) =>
      grnApi.approve(id, { grnNumber: num }),
    onSuccess: () => {
      toast.success('GRN approved — stock updated');
      setApproveId(null);
      setGrnNumber('');
      qc.invalidateQueries({ queryKey: ['grns'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => grnApi.reject(id, { reason }),
    onSuccess: () => {
      toast.success('GRN rejected');
      setRejectId(null);
      setRejectReason('');
      qc.invalidateQueries({ queryKey: ['grns'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<GRN>[] = [
    {
      key: 'grnNumber',
      header: 'GRN #',
      mono: true,
      render: (r) =>
        r.grnNumber ? (
          <span className="font-mono text-sm">{r.grnNumber}</span>
        ) : (
          <span className="text-secondary italic text-sm">Pending</span>
        ),
    },
    { key: 'purchaseOrderId', header: 'PO #', render: (r) => `PO-${r.purchaseOrderId}` },
    { key: 'supplierId', header: 'Supplier' },
    {
      key: 'grandTotal',
      header: 'Total',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.grandTotal)),
    },
    {
      key: 'receivedDate',
      header: 'Received',
      sortable: true,
      render: (r) => formatDate(r.receivedDate),
    },
    {
      key: 'hasPriceVariance',
      header: 'Price Variance',
      render: (r) =>
        r.hasPriceVariance ? (
          <Badge variant="danger">Yes</Badge>
        ) : (
          <Badge variant="default">No</Badge>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status.replace('_', ' ')}</Badge>
      ),
    },
  ];

  // Backend's approve()/reject() explicitly accept DRAFT as well as PENDING_APPROVAL
  // (GRNService.ts lines 237/488) — a zero-price-variance GRN (the common case) is
  // created straight into DRAFT, never PENDING_APPROVAL, so this row-action condition
  // being PENDING_APPROVAL-only meant a DRAFT GRN had no UI path to ever be approved:
  // stock was never posted and item cost (WACC) was never updated. Confirmed live —
  // every GRN created in this session's testing sat in DRAFT with zero inventory_ledger
  // rows and waccCost stuck at 0.00, despite real receipts against real POs.
  const rowActions: ERPRowAction<GRN>[] = [
    ...(canApproveGRN
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            onClick: (r: GRN) => {
              setApproveId(r.id);
              setGrnNumber('');
            },
            hidden: (r: GRN) => !['DRAFT', 'PENDING_APPROVAL'].includes(r.status),
          },
        ]
      : []),
    ...(canApproveGRN
      ? [
          {
            label: 'Reject',
            icon: XCircle,
            type: 'delete' as const,
            onClick: (r: GRN) => {
              setRejectId(r.id);
              setRejectReason('');
            },
            hidden: (r: GRN) => !['DRAFT', 'PENDING_APPROVAL'].includes(r.status),
          },
        ]
      : []),
    {
      label: 'Attachments',
      icon: Paperclip,
      onClick: (r: GRN) => setAttachmentsForId(r.id),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Goods Receipt Notes"
        subtitle="Track and approve incoming goods"
      >
        {canCreateGRN && (
          <Button onClick={() => navigate('/purchase/grns/new')}>+ Create GRN</Button>
        )}
      </ERPPageHeader>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by GRN number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All Statuses</option>
          {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
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

      <Modal isOpen={approveId !== null} onClose={() => setApproveId(null)} title="Approve GRN">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Approving will add stock to the warehouse and update the purchase order status.
          </p>
          <Input
            label="GRN Number"
            required
            placeholder="e.g. GRN-2025-001"
            value={grnNumber}
            onChange={(e) => setGrnNumber(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveId(null)}>
              Cancel
            </Button>
            <Button
              isLoading={approveMutation.isPending}
              disabled={!grnNumber.trim()}
              onClick={() =>
                approveId !== null && approveMutation.mutate({ id: approveId, num: grnNumber })
              }
            >
              Approve &amp; Add Stock
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={rejectId !== null} onClose={() => setRejectId(null)} title="Reject GRN">
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
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={rejectMutation.isPending}
              disabled={!rejectReason.trim()}
              onClick={() =>
                rejectId !== null && rejectMutation.mutate({ id: rejectId, reason: rejectReason })
              }
            >
              Reject GRN
            </Button>
          </div>
        </div>
      </Modal>

      <ERPDrawer
        open={attachmentsForId !== null}
        onClose={() => setAttachmentsForId(null)}
        title="GRN Attachments"
        size="lg"
      >
        {attachmentsForId !== null && (
          <AttachmentSection service="purchase" entityType="GRN" entityId={attachmentsForId} />
        )}
      </ERPDrawer>
    </div>
  );
}
