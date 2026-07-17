import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Send, CheckCircle2, PackageCheck, Paperclip, Copy, Ban } from 'lucide-react';
import { purchaseOrderApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
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
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Modal from '../../components/ui/Modal.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface PurchaseOrder {
  id: number;
  poNumber: string | null;
  supplierId: number;
  supplierName?: string;
  status: string;
  grandTotal: string;
  expectedDeliveryDate: string | null;
  poDate: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreatePO = hasPermission(PERMISSIONS.PO_CREATE);
  const canApprovePO = hasPermission(PERMISSIONS.PO_APPROVE);
  const canCancelPO = hasPermission(PERMISSIONS.PO_CANCEL);
  const canCreateGRN = hasPermission(PERMISSIONS.GRN_CREATE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [approveId, setApproveId] = useState<number | null>(null);
  const [poNumber, setPoNumber] = useState('');
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [attachmentsForId, setAttachmentsForId] = useState<number | null>(null);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', debouncedSearch, status, page, pageSize],
    queryFn: () =>
      purchaseOrderApi.list({
        search: debouncedSearch || undefined,
        status: status || undefined,
        page,
        pageSize,
      }),
    staleTime: 30_000,
  });

  const rows: PurchaseOrder[] =
    ((data as Record<string, unknown>)?.content as PurchaseOrder[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const submitMutation = useMutation({
    mutationFn: (id: number) => purchaseOrderApi.submit(id),
    onSuccess: () => {
      toast.success('PO submitted for approval');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, poNumber: num }: { id: number; poNumber: string }) =>
      purchaseOrderApi.approve(id, { poNumber: num }),
    onSuccess: () => {
      toast.success('PO approved');
      setApproveId(null);
      setPoNumber('');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      purchaseOrderApi.cancel(id, { reason }),
    onSuccess: () => {
      toast.success('PO cancelled');
      setCancelId(null);
      setCancelReason('');
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: number) => purchaseOrderApi.duplicate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('PO duplicated as draft');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<PurchaseOrder>[] = [
    {
      key: 'poNumber',
      header: 'PO #',
      mono: true,
      render: (r) =>
        r.poNumber ? (
          <span className="font-mono text-sm">{r.poNumber}</span>
        ) : (
          <span className="text-secondary italic text-sm">Draft</span>
        ),
    },
    { key: 'supplierName', header: 'Supplier', render: (r) => r.supplierName ?? r.supplierId },
    {
      key: 'grandTotal',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.grandTotal)),
    },
    { key: 'poDate', header: 'Order Date', sortable: true, render: (r) => formatDate(r.poDate) },
    {
      key: 'expectedDeliveryDate',
      header: 'Expected Delivery',
      render: (r) => (r.expectedDeliveryDate ? formatDate(r.expectedDeliveryDate) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<PurchaseOrder>[] = [
    ...(canCreatePO
      ? [
          {
            label: 'Submit',
            icon: Send,
            onClick: (r: PurchaseOrder) => submitMutation.mutate(r.id),
            hidden: (r: PurchaseOrder) => r.status !== 'DRAFT',
          },
        ]
      : []),
    ...(canApprovePO
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            onClick: (r: PurchaseOrder) => {
              setApproveId(r.id);
              setPoNumber('');
            },
            hidden: (r: PurchaseOrder) => r.status !== 'SUBMITTED',
          },
        ]
      : []),
    ...(canCreateGRN
      ? [
          {
            label: 'Receive',
            icon: PackageCheck,
            onClick: (r: PurchaseOrder) => navigate(`/purchase/grns/new?poId=${r.id}`),
            hidden: (r: PurchaseOrder) => !['APPROVED', 'PARTIALLY_RECEIVED'].includes(r.status),
          },
        ]
      : []),
    {
      label: 'Attachments',
      icon: Paperclip,
      onClick: (r: PurchaseOrder) => setAttachmentsForId(r.id),
    },
    ...(canCreatePO
      ? [
          {
            label: 'Duplicate',
            icon: Copy,
            type: 'duplicate' as const,
            onClick: (r: PurchaseOrder) => duplicateMutation.mutate(r.id),
          },
        ]
      : []),
    ...(canCancelPO
      ? [
          {
            label: 'Cancel',
            icon: Ban,
            type: 'delete' as const,
            onClick: (r: PurchaseOrder) => {
              setCancelId(r.id);
              setCancelReason('');
            },
            hidden: (r: PurchaseOrder) => !['DRAFT', 'SUBMITTED'].includes(r.status),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Purchase Orders"
        subtitle="Manage supplier purchase orders"
      >
        {canCreatePO && <Button onClick={() => navigate('/purchase/orders/new')}>+ New PO</Button>}
      </ERPPageHeader>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Search by PO number..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All Statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map(
            (s) => (
              <option key={s} value={s}>
                {s}
              </option>
            )
          )}
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

      <Modal
        isOpen={approveId !== null}
        onClose={() => setApproveId(null)}
        title="Approve Purchase Order"
      >
        <div className="space-y-4">
          <Input
            label="PO Number"
            required
            placeholder="e.g. PO-2025-001"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveId(null)}>
              Cancel
            </Button>
            <Button
              isLoading={approveMutation.isPending}
              disabled={!poNumber.trim()}
              onClick={() =>
                approveId !== null && approveMutation.mutate({ id: approveId, poNumber })
              }
            >
              Approve
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={cancelId !== null}
        onClose={() => setCancelId(null)}
        title="Cancel Purchase Order"
      >
        <div className="space-y-4">
          <Input
            label="Reason"
            required
            placeholder="Reason for cancellation"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelId(null)}>
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={cancelMutation.isPending}
              disabled={!cancelReason.trim()}
              onClick={() =>
                cancelId !== null && cancelMutation.mutate({ id: cancelId, reason: cancelReason })
              }
            >
              Cancel PO
            </Button>
          </div>
        </div>
      </Modal>

      <ERPDrawer
        open={attachmentsForId !== null}
        onClose={() => setAttachmentsForId(null)}
        title="Purchase Order Attachments"
        size="lg"
      >
        {attachmentsForId !== null && (
          <AttachmentSection
            service="purchase"
            entityType="PURCHASE_ORDER"
            entityId={attachmentsForId}
          />
        )}
      </ERPDrawer>
    </div>
  );
}
