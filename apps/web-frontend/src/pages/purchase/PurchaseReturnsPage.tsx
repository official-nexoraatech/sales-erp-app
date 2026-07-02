import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseReturnApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface PurchaseReturn {
  id: number;
  returnNumber: string;
  supplierId: number;
  grnId: number;
  status: string;
  grandTotal: string;
  returnDate: string;
  reason: string;
}

interface DebitNote {
  id: number;
  debitNoteNumber: string;
  supplierId: number;
  status: string;
  total: string;
  issueDate: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  APPROVED: 'success',
};

const DN_STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  ISSUED: 'warning',
  ADJUSTED: 'success',
  REFUNDED: 'success',
};

const RETURN_REASONS = ['DEFECTIVE', 'WRONG_ITEM', 'EXCESS_QTY', 'QUALITY_ISSUE', 'OTHER'] as const;

export default function PurchaseReturnsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'returns' | 'debit-notes'>('returns');
  const [showCreate, setShowCreate] = useState(false);
  const [grnId, setGrnId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState<string>('DEFECTIVE');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [returnNotes, setReturnNotes] = useState('');

  const { data: returnsData, isLoading: returnsLoading } = useQuery({
    queryKey: ['purchase-returns'],
    queryFn: () => purchaseReturnApi.list(),
    staleTime: 30_000,
  });

  const { data: dnData, isLoading: dnLoading } = useQuery({
    queryKey: ['debit-notes'],
    queryFn: () => purchaseReturnApi.debitNotes(),
    staleTime: 30_000,
    enabled: tab === 'debit-notes',
  });

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => purchaseReturnApi.create(d),
    onSuccess: () => {
      toast.success('Purchase return created as DRAFT');
      setShowCreate(false);
      setGrnId('');
      setSupplierId('');
      setReturnNotes('');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => purchaseReturnApi.approve(id),
    onSuccess: () => {
      toast.success('Purchase return approved — stock deducted, debit note created');
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['debit-notes'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returns: PurchaseReturn[] = (returnsData as { data?: PurchaseReturn[] })?.data ?? [];
  const debitNotes: DebitNote[] = (dnData as { data?: DebitNote[] })?.data ?? [];

  const returnColumns = [
    { key: 'returnNumber', header: 'Return #', render: (r: PurchaseReturn) => <span className="font-mono text-sm">{r.returnNumber}</span> },
    { key: 'supplierId', header: 'Supplier' },
    { key: 'grnId', header: 'GRN #', render: (r: PurchaseReturn) => `GRN-${r.grnId}` },
    { key: 'reason', header: 'Reason', render: (r: PurchaseReturn) => r.reason.replace('_', ' ') },
    { key: 'grandTotal', header: 'Amount', render: (r: PurchaseReturn) => formatCurrency(parseFloat(r.grandTotal)) },
    { key: 'returnDate', header: 'Date', render: (r: PurchaseReturn) => formatDate(r.returnDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r: PurchaseReturn) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r: PurchaseReturn) => r.status === 'DRAFT' ? (
        <Button
          size="sm"
          variant="primary"
          isLoading={approveMutation.isPending}
          onClick={() => approveMutation.mutate(r.id)}
        >
          Approve
        </Button>
      ) : null,
    },
  ];

  const dnColumns = [
    { key: 'debitNoteNumber', header: 'DN #', render: (r: DebitNote) => <span className="font-mono text-sm">{r.debitNoteNumber}</span> },
    { key: 'supplierId', header: 'Supplier' },
    { key: 'total', header: 'Amount', render: (r: DebitNote) => formatCurrency(parseFloat(r.total)) },
    { key: 'issueDate', header: 'Issue Date', render: (r: DebitNote) => formatDate(r.issueDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r: DebitNote) => <Badge variant={DN_STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Purchase Returns" subtitle="Manage returns to suppliers and debit notes">
        <Button onClick={() => setShowCreate(true)}>+ New Return</Button>
      </ERPPageHeader>

      <div className="flex gap-2 mb-4 border-b border-default">
        {(['returns', 'debit-notes'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-brand text-primary' : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t === 'returns' ? 'Returns' : 'Debit Notes'}
          </button>
        ))}
      </div>

      {tab === 'returns' && (
        <DataTable columns={returnColumns} data={returns} isLoading={returnsLoading} emptyMessage="No purchase returns found" />
      )}
      {tab === 'debit-notes' && (
        <DataTable columns={dnColumns} data={debitNotes} isLoading={dnLoading} emptyMessage="No debit notes found" />
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Purchase Return">
        <div className="space-y-4">
          <Input
            label="GRN ID *"
            type="number"
            placeholder="ID of the GRN to return against"
            value={grnId}
            onChange={(e) => setGrnId(e.target.value)}
          />
          <Input
            label="Supplier ID *"
            type="number"
            placeholder="Supplier ID"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          />
          <Input
            label="Return Date *"
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
          />
          <Select
            label="Reason *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            options={RETURN_REASONS.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
          />
          <Input
            label="Notes"
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            placeholder="Optional notes for this return"
          />
          <p className="text-xs text-secondary">
            After creating, the return is in DRAFT status. Approve it to deduct stock and auto-generate a debit note.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!grnId || !supplierId}
              onClick={() => createMutation.mutate({
                grnId: Number(grnId),
                supplierId: Number(supplierId),
                branchId: 1,
                returnDate: new Date(returnDate).toISOString(),
                reason,
                returnNotes: returnNotes || undefined,
                lines: [],
              })}
            >
              Create Return
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
