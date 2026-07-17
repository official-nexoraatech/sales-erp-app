import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import { purchaseReturnApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPTabs from '../../components/erp/ERPTabs.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface PurchaseReturn {
  id: number;
  returnNumber: string;
  supplierId: number;
  supplierName?: string;
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
  supplierName?: string;
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

export default function PurchaseReturnsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateReturn = hasPermission(PERMISSIONS.PURCHASE_RETURN_CREATE);
  const canApproveReturn = hasPermission(PERMISSIONS.PURCHASE_RETURN_APPROVE);
  const [tab, setTab] = useState<'returns' | 'debit-notes'>('returns');
  const [returnsPage, setReturnsPage] = useState(1);
  const [returnsPageSize, setReturnsPageSize] = useState(20);
  const [dnPage, setDnPage] = useState(1);
  const [dnPageSize, setDnPageSize] = useState(20);

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

  const returns: PurchaseReturn[] =
    ((returnsData as Record<string, unknown>)?.content as PurchaseReturn[]) ?? [];
  const returnsTotal = ((returnsData as Record<string, unknown>)?.totalElements as number) ?? 0;
  const debitNotes: DebitNote[] =
    ((dnData as Record<string, unknown>)?.content as DebitNote[]) ?? [];
  const dnTotal = ((dnData as Record<string, unknown>)?.totalElements as number) ?? 0;

  const returnColumns: ERPColumnDef<PurchaseReturn>[] = [
    { key: 'returnNumber', header: 'Return #', mono: true, sortable: true },
    { key: 'supplierName', header: 'Supplier', render: (r) => r.supplierName ?? r.supplierId },
    { key: 'grnId', header: 'GRN #', render: (r) => `GRN-${r.grnId}` },
    { key: 'reason', header: 'Reason', render: (r) => r.reason.replace('_', ' ') },
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
    ...(canApproveReturn
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            onClick: (r: PurchaseReturn) => approveMutation.mutate(r.id),
            hidden: (r: PurchaseReturn) => r.status !== 'DRAFT',
          },
        ]
      : []),
  ];

  const dnColumns: ERPColumnDef<DebitNote>[] = [
    { key: 'debitNoteNumber', header: 'DN #', mono: true },
    { key: 'supplierName', header: 'Supplier', render: (r) => r.supplierName ?? r.supplierId },
    {
      key: 'total',
      header: 'Amount',
      align: 'right',
      render: (r) => formatCurrency(parseFloat(r.total)),
    },
    { key: 'issueDate', header: 'Issue Date', render: (r) => formatDate(r.issueDate) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={DN_STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Purchase Returns"
        subtitle="Manage returns to suppliers and debit notes"
      >
        {canCreateReturn && (
          <Button onClick={() => navigate('/purchase/returns/new')}>+ New Return</Button>
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
          pagination={{ page: returnsPage, pageSize: returnsPageSize, total: returnsTotal }}
          onPageChange={setReturnsPage}
          onPageSizeChange={(size) => {
            setReturnsPageSize(size);
            setReturnsPage(1);
          }}
          actions={returnRowActions}
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
        />
      )}
    </div>
  );
}
