import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { grnApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
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
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

export default function GRNsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [approveId, setApproveId] = useState<number | null>(null);
  const [grnNumber, setGrnNumber] = useState('');
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['grns', status],
    queryFn: () => grnApi.list(status ? { status } : {}),
    staleTime: 30_000,
  });

  const rows: GRN[] = (data as { data?: GRN[] })?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: ({ id, num }: { id: number; num: string }) => grnApi.approve(id, { grnNumber: num }),
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

  const columns = [
    {
      key: 'grnNumber',
      header: 'GRN #',
      render: (r: GRN) => r.grnNumber
        ? <span className="font-mono text-sm">{r.grnNumber}</span>
        : <span className="text-secondary italic text-sm">Pending</span>,
    },
    { key: 'purchaseOrderId', header: 'PO #', render: (r: GRN) => `PO-${r.purchaseOrderId}` },
    { key: 'supplierId', header: 'Supplier' },
    { key: 'grandTotal', header: 'Total', render: (r: GRN) => formatCurrency(parseFloat(r.grandTotal)) },
    { key: 'receivedDate', header: 'Received', render: (r: GRN) => formatDate(r.receivedDate) },
    {
      key: 'hasPriceVariance',
      header: 'Price Variance',
      render: (r: GRN) => r.hasPriceVariance
        ? <Badge variant="danger">Yes</Badge>
        : <Badge variant="default">No</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r: GRN) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status.replace('_', ' ')}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r: GRN) => r.status === 'PENDING_APPROVAL' ? (
        <div className="flex gap-1">
          <Button size="sm" variant="primary" onClick={() => { setApproveId(r.id); setGrnNumber(''); }}>
            Approve
          </Button>
          <Button size="sm" variant="danger" onClick={() => { setRejectId(r.id); setRejectReason(''); }}>
            Reject
          </Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Goods Receipt Notes" subtitle="Track and approve incoming goods">
        <Button onClick={() => navigate('/purchase/grns/new')}>+ Create GRN</Button>
      </ERPPageHeader>

      <div className="flex gap-4 mb-4">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-default bg-surface-card text-primary text-sm px-3 py-2"
        >
          <option value="">All Statuses</option>
          {['PENDING_APPROVAL', 'APPROVED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No GRNs found" />

      <Modal isOpen={approveId !== null} onClose={() => setApproveId(null)} title="Approve GRN">
        <div className="space-y-4">
          <p className="text-sm text-secondary">
            Approving will add stock to the warehouse and update the purchase order status.
          </p>
          <Input
            label="GRN Number *"
            placeholder="e.g. GRN-2025-001"
            value={grnNumber}
            onChange={(e) => setGrnNumber(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveId(null)}>Cancel</Button>
            <Button
              isLoading={approveMutation.isPending}
              disabled={!grnNumber.trim()}
              onClick={() => approveId !== null && approveMutation.mutate({ id: approveId, num: grnNumber })}
            >
              Approve &amp; Add Stock
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={rejectId !== null} onClose={() => setRejectId(null)} title="Reject GRN">
        <div className="space-y-4">
          <Input
            label="Reason *"
            placeholder="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button
              variant="danger"
              isLoading={rejectMutation.isPending}
              disabled={!rejectReason.trim()}
              onClick={() => rejectId !== null && rejectMutation.mutate({ id: rejectId, reason: rejectReason })}
            >
              Reject GRN
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
