import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Eye, Truck, ArrowRightLeft, FileText } from 'lucide-react';
import { deliveryChallanApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface DeliveryChallan {
  id: number;
  challanNumber: string;
  customerId: number;
  challanDate: string;
  status: string;
  subtotal: string;
  convertedInvoiceId?: number;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  DISPATCHED: 'warning',
  CONVERTED: 'success',
  CANCELLED: 'danger',
};

export default function DeliveryChallansPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreateChallan = useAuthStore((s) => s.hasPermission(PERMISSIONS.INVOICE_CREATE));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-challans', page, pageSize],
    queryFn: () => deliveryChallanApi.list({ page, pageSize }),
    staleTime: 30_000,
  });

  const rows: DeliveryChallan[] =
    ((data as Record<string, unknown>)?.content as DeliveryChallan[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const dispatchMutation = useMutation({
    mutationFn: (id: number) => deliveryChallanApi.dispatch(id),
    onSuccess: () => {
      toast.success('Challan dispatched');
      qc.invalidateQueries({ queryKey: ['delivery-challans'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertMutation = useMutation({
    mutationFn: (id: number) => deliveryChallanApi.convertToInvoice(id),
    onSuccess: (_data, id) => {
      toast.success('Ready to create invoice');
      navigate(`/sales/invoices/new?challanId=${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<DeliveryChallan>[] = [
    { key: 'challanNumber', header: 'Challan #', mono: true, sortable: true },
    { key: 'customerId', header: 'Customer' },
    {
      key: 'challanDate',
      header: 'Date',
      sortable: true,
      render: (r) => formatDate(r.challanDate),
    },
    {
      key: 'subtotal',
      header: 'Value',
      align: 'right',
      sortable: true,
      render: (r) => formatCurrency(parseFloat(r.subtotal)),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge>,
    },
  ];

  const rowActions: ERPRowAction<DeliveryChallan>[] = [
    {
      label: 'View',
      icon: Eye,
      type: 'view',
      onClick: (r: DeliveryChallan) => navigate(`/sales/delivery-challans/${r.id}`),
    },
    ...(canCreateChallan
      ? [
          {
            label: 'Dispatch',
            icon: Truck,
            onClick: (r: DeliveryChallan) => dispatchMutation.mutate(r.id),
            hidden: (r: DeliveryChallan) => r.status !== 'DRAFT',
          },
        ]
      : []),
    ...(canCreateChallan
      ? [
          {
            label: 'Convert to Invoice',
            icon: ArrowRightLeft,
            onClick: (r: DeliveryChallan) => convertMutation.mutate(r.id),
            hidden: (r: DeliveryChallan) => !['DRAFT', 'DISPATCHED'].includes(r.status),
          },
        ]
      : []),
    {
      label: 'View Invoice',
      icon: FileText,
      type: 'view',
      onClick: (r: DeliveryChallan) => navigate(`/sales/invoices/${r.convertedInvoiceId}`),
      hidden: (r: DeliveryChallan) => !r.convertedInvoiceId,
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Delivery Challans"
        subtitle="Manage goods dispatched before invoicing"
      >
        {canCreateChallan && (
          <Button onClick={() => navigate('/sales/delivery-challans/new')}>+ New Challan</Button>
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
        actions={rowActions}
      />
    </div>
  );
}
