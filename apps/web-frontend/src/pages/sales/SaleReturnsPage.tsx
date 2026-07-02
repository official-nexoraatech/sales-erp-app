import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { saleReturnApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPSwitch from '../../components/erp/ERPSwitch.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatCurrency } from '../../lib/format.js';

interface SaleReturn {
  id: number;
  returnNumber: string;
  invoiceId: number;
  customerId: number;
  returnDate: string;
  status: string;
  totalAmount: string;
  reason: string;
  creditNoteId?: number;
}

export default function SaleReturnsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [reason, setReason] = useState('DEFECTIVE');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [isPhysical, setIsPhysical] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ['sale-returns'],
    queryFn: () => saleReturnApi.list(),
    staleTime: 30_000,
  });

  const rows: SaleReturn[] = (data as { data?: SaleReturn[] })?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => saleReturnApi.create(d),
    onSuccess: () => {
      toast.success('Sale return created — credit note generated');
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['sale-returns'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    { key: 'returnNumber', header: 'Return #', className: 'font-mono text-sm' },
    { key: 'invoiceId', header: 'Invoice' },
    { key: 'reason', header: 'Reason' },
    { key: 'totalAmount', header: 'Amount', render: (r: SaleReturn) => formatCurrency(parseFloat(r.totalAmount)) },
    { key: 'returnDate', header: 'Date', render: (r: SaleReturn) => formatDate(r.returnDate) },
    { key: 'status', header: 'Status', render: (r: SaleReturn) => <Badge variant={r.status === 'APPROVED' ? 'success' : r.status === 'CANCELLED' ? 'danger' : 'default'}>{r.status}</Badge> },
    {
      key: 'creditNoteId',
      header: 'Credit Note',
      render: (r: SaleReturn) => r.creditNoteId
        ? <span className="font-mono text-sm text-blue-600">CN-{r.creditNoteId}</span>
        : '—',
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Sale Returns" subtitle="Process customer returns and credit notes">
        <Button onClick={() => setShowCreate(true)}>+ New Return</Button>
      </ERPPageHeader>

      <DataTable columns={columns} data={rows} isLoading={isLoading} emptyMessage="No sale returns found" />

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Sale Return">
        <div className="space-y-4">
          <Input label="Invoice ID *" type="number" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
          <Input label="Customer ID *" type="number" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
          <Input label="Return Date *" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          <Select
            label="Reason *"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            options={[
              { value: 'DEFECTIVE', label: 'Defective' },
              { value: 'WRONG_ITEM', label: 'Wrong Item' },
              { value: 'CUSTOMER_CHANGE_MIND', label: 'Customer Changed Mind' },
              { value: 'QUALITY_ISSUE', label: 'Quality Issue' },
              { value: 'OTHER', label: 'Other' },
            ]}
          />
          <ERPSwitch
            label="Physical Return"
            description="Stock will be restored to warehouse"
            checked={isPhysical}
            onChange={setIsPhysical}
          />
          <p className="text-xs text-secondary">
            Note: After creating the return, add line items by editing the return record.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              isLoading={createMutation.isPending}
              disabled={!invoiceId || !customerId}
              onClick={() => createMutation.mutate({
                invoiceId: Number(invoiceId),
                customerId: Number(customerId),
                branchId: 1,
                returnDate: new Date(returnDate).toISOString(),
                reason,
                isPhysicalReturn: isPhysical,
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
