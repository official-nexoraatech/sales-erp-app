import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseOrderApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Modal from '../../components/ui/Modal.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface PurchaseOrder {
  id: number;
  poNumber: string | null;
  supplierId: number;
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
  const [status, setStatus] = useState('');
  const [approveId, setApproveId] = useState<number | null>(null);
  const [poNumber, setPoNumber] = useState('');
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders', status],
    queryFn: () => purchaseOrderApi.list(status ? { status } : {}),
    staleTime: 30_000,
  });

  const rows: PurchaseOrder[] = (data as { data?: PurchaseOrder[] })?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (id: number) => purchaseOrderApi.submit(id),
    onSuccess: () => { toast.success('PO submitted for approval'); qc.invalidateQueries({ queryKey: ['purchase-orders'] }); },
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

  const columns = [
    {
      key: 'poNumber',
      header: 'PO #',
      render: (r: PurchaseOrder) => r.poNumber
        ? <span className="font-mono text-sm">{r.poNumber}</span>
        : <span className="text-secondary italic text-sm">Draft</span>,
    },
    { key: 'supplierId', header: 'Supplier' },
    { key: 'grandTotal', header: 'Amount', render: (r: PurchaseOrder) => formatCurrency(parseFloat(r.grandTotal)) },
    { key: 'poDate', header: 'Order Date', render: (r: PurchaseOrder) => formatDate(r.poDate) },
    {
      key: 'expectedDeliveryDate',
      header: 'Expected Delivery',
      render: (r: PurchaseOrder) => r.expectedDeliveryDate ? formatDate(r.expectedDeliveryDate) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: PurchaseOrder) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r: PurchaseOrder) => (
        <div className="flex gap-1 flex-wrap">
          {r.status === 'DRAFT' && (
            <Button size="sm" onClick={() => submitMutation.mutate(r.id)}>Submit</Button>
          )}
          {r.status === 'SUBMITTED' && (
            <Button size="sm" variant="primary" onClick={() => { setApproveId(r.id); setPoNumber(''); }}>
              Approve
            </Button>
          )}
          {['APPROVED', 'PARTIALLY_RECEIVED'].includes(r.status) && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/purchase/grns/new?poId=${r.id}`)}>
              Receive
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => duplicateMutation.mutate(r.id)}>Copy</Button>
          {['DRAFT', 'SUBMITTED'].includes(r.status) && (
            <Button size="sm" variant="danger" onClick={() => { setCancelId(r.id); setCancelReason(''); }}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Purchase Orders" subtitle="Manage supplier purchase orders">
        <Button onClick={() => navigate('/purchase/orders/new')}>+ New PO</Button>
      </ERPPageHeader>

      <div className="flex gap-4 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
        >
          <option value="">All Statuses</option>
          {['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No purchase orders found" />

      <Modal isOpen={approveId !== null} onClose={() => setApproveId(null)} title="Approve Purchase Order">
        <div className="space-y-4">
          <Input
            label="PO Number *"
            placeholder="e.g. PO-2025-001"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveId(null)}>Cancel</Button>
            <Button
              isLoading={approveMutation.isPending}
              disabled={!poNumber.trim()}
              onClick={() => approveId !== null && approveMutation.mutate({ id: approveId, poNumber })}
            >
              Approve
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={cancelId !== null} onClose={() => setCancelId(null)} title="Cancel Purchase Order">
        <div className="space-y-4">
          <Input
            label="Reason *"
            placeholder="Reason for cancellation"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCancelId(null)}>Back</Button>
            <Button
              variant="danger"
              isLoading={cancelMutation.isPending}
              disabled={!cancelReason.trim()}
              onClick={() => cancelId !== null && cancelMutation.mutate({ id: cancelId, reason: cancelReason })}
            >
              Cancel PO
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
