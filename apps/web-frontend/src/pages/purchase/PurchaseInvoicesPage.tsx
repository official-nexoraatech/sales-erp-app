import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2 } from 'lucide-react';
import { purchaseInvoiceApi } from '../../api/endpoints.js';
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
import { formatDate, formatCurrency } from '../../lib/format.js';

interface PurchaseInvoice {
  id: number;
  invoiceNumber: string | null;
  supplierInvoiceNumber: string;
  supplierId: number;
  invoiceDate: string;
  status: string;
  grandTotal: string;
  varianceAmount: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  MATCHED: 'success',
  VARIANCE: 'warning',
  APPROVED: 'success',
};

export default function PurchaseInvoicesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission(PERMISSIONS.PURCHASE_INVOICE_CREATE);
  const canApprove = hasPermission(PERMISSIONS.PURCHASE_INVOICE_APPROVE);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-invoices', status],
    queryFn: () => purchaseInvoiceApi.list({ status: status || undefined }),
    staleTime: 30_000,
  });

  const rows: PurchaseInvoice[] =
    ((data as Record<string, unknown>)?.content as PurchaseInvoice[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? rows.length;

  const approveMutation = useMutation({
    mutationFn: (id: number) => purchaseInvoiceApi.approve(id),
    onSuccess: () => {
      toast.success('Purchase invoice approved');
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<PurchaseInvoice>[] = [
    {
      key: 'supplierInvoiceNumber',
      header: "Supplier's Invoice #",
      mono: true,
    },
    { key: 'invoiceDate', header: 'Invoice Date', render: (r) => formatDate(r.invoiceDate) },
    {
      key: 'grandTotal',
      header: 'Amount',
      align: 'right',
      render: (r) => formatCurrency(parseFloat(r.grandTotal)),
    },
    {
      key: 'varianceAmount',
      header: 'Variance vs GRN',
      align: 'right',
      render: (r) => {
        const v = parseFloat(r.varianceAmount);
        return (
          <span className={v !== 0 ? 'text-warning font-medium' : 'text-secondary'}>
            {formatCurrency(v)}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<PurchaseInvoice>[] = [
    ...(canApprove
      ? [
          {
            label: 'Approve',
            icon: CheckCircle2,
            onClick: (r: PurchaseInvoice) => approveMutation.mutate(r.id),
            hidden: (r: PurchaseInvoice) => r.status === 'APPROVED',
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Purchase Invoices"
        subtitle="Supplier-billed invoices matched against PO/GRN — a reconciliation record, does not re-post accounting/GST (GRN approval already does that)"
      >
        {canCreate && (
          <Button onClick={() => navigate('/purchase/invoices/new')}>+ Record Invoice</Button>
        )}
      </ERPPageHeader>

      <div className="flex flex-wrap gap-4 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="">All Statuses</option>
          {['MATCHED', 'VARIANCE', 'APPROVED'].map((s) => (
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
              title="No purchase invoices recorded yet"
              description="Record what a supplier actually billed against a GRN to flag quantity/rate variance before payment."
              {...(canCreate
                ? {
                    action: {
                      label: '+ Record Invoice',
                      onClick: () => navigate('/purchase/invoices/new'),
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
    </div>
  );
}
