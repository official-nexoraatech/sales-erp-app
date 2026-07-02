import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { deliveryChallanApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

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

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-challans'],
    queryFn: () => deliveryChallanApi.list(),
    staleTime: 30_000,
  });

  const rows: DeliveryChallan[] = (data as { data?: DeliveryChallan[] })?.data ?? [];

  const dispatchMutation = useMutation({
    mutationFn: (id: number) => deliveryChallanApi.dispatch(id),
    onSuccess: () => { toast.success('Challan dispatched'); qc.invalidateQueries({ queryKey: ['delivery-challans'] }); },
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

  const columns = [
    { key: 'challanNumber', header: 'Challan #', className: 'font-mono text-sm' },
    { key: 'customerId', header: 'Customer' },
    { key: 'challanDate', header: 'Date', render: (r: DeliveryChallan) => formatDate(r.challanDate) },
    { key: 'subtotal', header: 'Value', render: (r: DeliveryChallan) => formatCurrency(parseFloat(r.subtotal)) },
    { key: 'status', header: 'Status', render: (r: DeliveryChallan) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge> },
    {
      key: 'actions',
      header: '',
      render: (r: DeliveryChallan) => (
        <div className="flex gap-2">
          {r.status === 'DRAFT' && (
            <Button size="sm" onClick={() => dispatchMutation.mutate(r.id)}>Dispatch</Button>
          )}
          {['DRAFT', 'DISPATCHED'].includes(r.status) && (
            <Button size="sm" onClick={() => convertMutation.mutate(r.id)}>Convert to Invoice</Button>
          )}
          {r.convertedInvoiceId && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/sales/invoices/${r.convertedInvoiceId}`)}>
              View Invoice
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Delivery Challans" subtitle="Manage goods dispatched before invoicing">
        <Button onClick={() => navigate('/sales/delivery-challans/new')}>+ New Challan</Button>
      </ERPPageHeader>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No delivery challans found" />
    </div>
  );
}
