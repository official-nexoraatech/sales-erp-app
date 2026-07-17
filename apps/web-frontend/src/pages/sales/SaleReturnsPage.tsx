import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { saleReturnApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface SaleReturn {
  id: number;
  returnNumber: string;
  invoiceId: number;
  invoiceNumber?: string;
  customerId: number;
  customerName?: string;
  returnDate: string;
  status: string;
  totalAmount: string;
  reason: string;
  creditNoteId?: number;
}

export default function SaleReturnsPage() {
  const navigate = useNavigate();
  const canCreateReturn = useAuthStore((s) => s.hasPermission(PERMISSIONS.INVOICE_CANCEL));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['sale-returns', page, pageSize],
    queryFn: () => saleReturnApi.list({ page, pageSize }),
    staleTime: 30_000,
  });

  const rows: SaleReturn[] = ((data as Record<string, unknown>)?.content as SaleReturn[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const columns: ERPColumnDef<SaleReturn>[] = [
    { key: 'returnNumber', header: 'Return #', mono: true, sortable: true },
    { key: 'invoiceNumber', header: 'Invoice', render: (r) => r.invoiceNumber ?? r.invoiceId },
    { key: 'customerName', header: 'Customer', render: (r) => r.customerName ?? r.customerId },
    { key: 'reason', header: 'Reason' },
    {
      key: 'totalAmount',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.totalAmount)),
    },
    { key: 'returnDate', header: 'Date', sortable: true, render: (r) => formatDate(r.returnDate) },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge
          variant={
            r.status === 'APPROVED' ? 'success' : r.status === 'CANCELLED' ? 'danger' : 'default'
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'creditNoteId',
      header: 'Credit Note',
      render: (r) =>
        r.creditNoteId ? (
          <span className="font-mono text-sm text-link">CN-{r.creditNoteId}</span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Sale Returns"
        subtitle="Process customer returns and credit notes"
      >
        {canCreateReturn && (
          <Button onClick={() => navigate('/sales/returns/new')}>+ New Return</Button>
        )}
      </ERPPageHeader>

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
      />
    </div>
  );
}
