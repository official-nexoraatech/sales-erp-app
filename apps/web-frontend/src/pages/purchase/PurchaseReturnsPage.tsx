import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, CheckCircle2, IndianRupee } from 'lucide-react';
import { purchaseReturnApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPTabs from '../../components/erp/ERPTabs.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface PurchaseReturn {
  id: number;
  returnNumber: string;
  supplierId: number;
  supplierName?: string;
  grnId: number;
  grnNumber?: string;
  status: string;
  grandTotal: string;
  returnDate: string;
  reason: string;
}

interface DebitNote {
  id: number;
  debitNoteNumber: string;
  supplierId: number;
  supplierName?: string;
  status: string;
  amount: string;
  appliedAmount: string;
  balanceAmount: string;
  issueDate: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  APPROVED: 'success',
};

// Was DRAFT/ISSUED/ADJUSTED/REFUNDED — none of those match debit_notes.status's actual
// enum (OPEN/PARTIALLY_APPLIED/APPLIED/CANCELLED, packages/db-client/src/schema/purchase.ts),
// so every debit note badge silently fell through to the 'default' color.
const DN_STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'warning',
  PARTIALLY_APPLIED: 'default',
  APPLIED: 'success',
  CANCELLED: 'danger',
};

export default function PurchaseReturnsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateReturn = hasPermission(PERMISSIONS.PURCHASE_RETURN_CREATE);
  const canApproveReturn = hasPermission(PERMISSIONS.PURCHASE_RETURN_APPROVE);
  const [tab, setTab] = useState<'returns' | 'debit-notes'>('returns');
  const [returnsPage, setReturnsPage] = useState(1);
  const [returnsPageSize, setReturnsPageSize] = useState(20);
  const [dnPage, setDnPage] = useState(1);
  const [dnPageSize, setDnPageSize] = useState(20);
  const [applyDn, setApplyDn] = useState<DebitNote | null>(null);
  const [applyAmount, setApplyAmount] = useState('');
  const [applyNotes, setApplyNotes] = useState('');

  const { data: returnsData, isLoading: returnsLoading } = useQuery({
    queryKey: ['purchase-returns', returnsPage, returnsPageSize],
    queryFn: () => purchaseReturnApi.list({ page: returnsPage, pageSize: returnsPageSize }),
    staleTime: 30_000,
  });

  const { data: dnData, isLoading: dnLoading } = useQuery({
    queryKey: ['debit-notes', dnPage, dnPageSize],
    queryFn: () => purchaseReturnApi.debitNotes({ page: dnPage, pageSize: dnPageSize }),
    staleTime: 30_000,
    enabled: tab === 'debit-notes',
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

  const applyMutation = useMutation({
    mutationFn: ({ id, amount, notes }: { id: number; amount: number; notes: string }) =>
      purchaseReturnApi.applyDebitNote(id, { amount, ...(notes ? { notes } : {}) }),
    onSuccess: () => {
      toast.success('Debit note applied');
      qc.invalidateQueries({ queryKey: ['debit-notes'] });
      setApplyDn(null);
      setApplyAmount('');
      setApplyNotes('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returns: PurchaseReturn[] =
    ((returnsData as Record<string, unknown>)?.content as PurchaseReturn[]) ?? [];
  const returnsTotal = ((returnsData as Record<string, unknown>)?.totalElements as number) ?? 0;
  const debitNotes: DebitNote[] =
    ((dnData as Record<string, unknown>)?.content as DebitNote[]) ?? [];
  const dnTotal = ((dnData as Record<string, unknown>)?.totalElements as number) ?? 0;

  const returnColumns: ERPColumnDef<PurchaseReturn>[] = [
    { key: 'returnNumber', header: 'Return #', mono: true, sortable: true },
    { key: 'supplierName', header: 'Supplier', render: (r) => r.supplierName ?? r.supplierId },
    { key: 'grnId', header: 'GRN #', render: (r) => r.grnNumber ?? `GRN-${r.grnId}` },
    { key: 'reason', header: 'Reason', render: (r) => r.reason.replace(/_/g, ' ') },
    {
      key: 'grandTotal',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.grandTotal)),
    },
    { key: 'returnDate', header: 'Date', sortable: true, render: (r) => formatDate(r.returnDate) },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const returnRowActions: ERPRowAction<PurchaseReturn>[] = [
    {
      label: 'View',
      icon: Eye,
      onClick: (r: PurchaseReturn) => navigate(`/purchase/returns/${r.id}`),
    },
    ...(canApproveReturn
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            tourId: 'purchase-return-approve-row-action',
            onClick: async (r: PurchaseReturn) => {
              const ok = await confirm({
                title: 'Approve purchase return?',
                message: `This will deduct the returned quantity from stock and generate a debit note against ${r.supplierName ?? 'this supplier'}. This cannot be undone.`,
                confirmLabel: 'Approve',
                variant: 'primary',
              });
              if (ok) approveMutation.mutate(r.id);
            },
            hidden: (r: PurchaseReturn) => r.status !== 'DRAFT',
          },
        ]
      : []),
  ];

  const canApplyDebitNote = hasPermission(PERMISSIONS.PURCHASE_RETURN_APPROVE);

  const dnColumns: ERPColumnDef<DebitNote>[] = [
    { key: 'debitNoteNumber', header: 'DN #', mono: true },
    { key: 'supplierName', header: 'Supplier', render: (r) => r.supplierName ?? r.supplierId },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => formatCurrency(parseFloat(r.amount)),
    },
    {
      key: 'balanceAmount',
      header: 'Balance',
      align: 'right',
      render: (r) => formatCurrency(parseFloat(r.balanceAmount)),
    },
    { key: 'issueDate', header: 'Issue Date', render: (r) => formatDate(r.issueDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={DN_STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const dnRowActions: ERPRowAction<DebitNote>[] = [
    ...(canApplyDebitNote
      ? [
          {
            label: 'Apply',
            icon: IndianRupee,
            onClick: (r: DebitNote) => {
              setApplyDn(r);
              setApplyAmount(r.balanceAmount);
              setApplyNotes('');
            },
            hidden: (r: DebitNote) => r.status !== 'OPEN' && r.status !== 'PARTIALLY_APPLIED',
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Purchase Returns"
        subtitle="Manage returns to suppliers and debit notes"
      >
        {canCreateReturn && (
          <Button
            data-tour-id="purchase-returns-create-button"
            onClick={() => navigate('/purchase/returns/new')}
          >
            + New Return
          </Button>
        )}
      </ERPPageHeader>

      <ERPTabs
        className="mb-4"
        tabs={[
          { key: 'returns', label: 'Returns' },
          { key: 'debit-notes', label: 'Debit Notes' },
        ]}
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
      />

      {tab === 'returns' && (
        <ERPDataGrid
          columns={returnColumns}
          data={returns}
          isLoading={returnsLoading}
          rowKey="id"
          enableExport
          exportFilename="purchase-returns"
          pagination={{ page: returnsPage, pageSize: returnsPageSize, total: returnsTotal }}
          onPageChange={setReturnsPage}
          onPageSizeChange={(size) => {
            setReturnsPageSize(size);
            setReturnsPage(1);
          }}
          actions={returnRowActions}
          emptyState={
            <ERPEmptyState
              type="no-data"
              title="No purchase returns yet"
              description="Return goods received from a supplier against a GRN — this deducts the returned stock and generates a debit note."
              {...(canCreateReturn
                ? {
                    action: {
                      label: '+ New Return',
                      onClick: () => navigate('/purchase/returns/new'),
                    },
                  }
                : {})}
            />
          }
        />
      )}
      {tab === 'debit-notes' && (
        <ERPDataGrid
          columns={dnColumns}
          data={debitNotes}
          isLoading={dnLoading}
          rowKey="id"
          pagination={{ page: dnPage, pageSize: dnPageSize, total: dnTotal }}
          onPageChange={setDnPage}
          onPageSizeChange={(size) => {
            setDnPageSize(size);
            setDnPage(1);
          }}
          actions={dnRowActions}
          emptyState={
            <ERPEmptyState
              type="no-data"
              title="No debit notes yet"
              description="A debit note is generated automatically when a purchase return is approved."
            />
          }
        />
      )}

      <Modal isOpen={applyDn !== null} onClose={() => setApplyDn(null)} title="Apply Debit Note">
        {applyDn && (
          <div className="space-y-4">
            <p className="text-sm text-secondary">
              Record that {formatCurrency(parseFloat(applyAmount || '0'))} of debit note{' '}
              <span className="font-mono">{applyDn.debitNoteNumber}</span> (balance{' '}
              {formatCurrency(parseFloat(applyDn.balanceAmount))}) has been matched against a
              supplier bill or payment.
            </p>
            <Input
              label="Amount to Apply (₹)"
              type="number"
              step="0.01"
              min="0"
              max={applyDn.balanceAmount}
              value={applyAmount}
              onChange={(e) => setApplyAmount(e.target.value)}
              required
            />
            <Input
              label="Notes"
              placeholder="e.g. Adjusted against Payment #123"
              value={applyNotes}
              onChange={(e) => setApplyNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setApplyDn(null)}>
                Cancel
              </Button>
              <Button
                isLoading={applyMutation.isPending}
                disabled={!applyAmount || parseFloat(applyAmount) <= 0}
                onClick={() =>
                  applyDn &&
                  applyMutation.mutate({
                    id: applyDn.id,
                    amount: parseFloat(applyAmount),
                    notes: applyNotes,
                  })
                }
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
