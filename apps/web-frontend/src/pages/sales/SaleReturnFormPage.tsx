import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { saleReturnApi, invoiceApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import ERPSwitch from '../../components/erp/ERPSwitch.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatCurrency } from '../../lib/format.js';

interface InvoiceLine {
  id: number;
  itemId: number;
  quantity: string;
  unitPrice: string;
  hsnCode?: string;
}

interface InvoiceForReturn {
  id: number;
  customerId: number;
  branchId: number;
  lines: InvoiceLine[];
}

const LIST_PATH = '/sales/returns';

export default function SaleReturnFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [invoiceId, setInvoiceId] = useState('');
  const [loadedInvoiceId, setLoadedInvoiceId] = useState<number | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('DEFECTIVE');
  const [returnDate, setReturnDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [isPhysical, setIsPhysical] = useState(true);

  const { data: invoiceData, isFetching: loadingInvoice } = useQuery({
    queryKey: ['invoice-for-return', loadedInvoiceId],
    queryFn: () => invoiceApi.getById(loadedInvoiceId!),
    enabled: loadedInvoiceId !== null,
  });
  const invoice = invoiceData as InvoiceForReturn | undefined;

  const createMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => saleReturnApi.create(d),
    onSuccess: () => {
      toast.success('Sale return created — credit note generated');
      qc.invalidateQueries({ queryKey: ['sale-returns'] });
      navigate(LIST_PATH);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedLines = invoice
    ? invoice.lines
        .map((l) => ({ line: l, qty: parseFloat(returnQtys[l.id] ?? '0') }))
        .filter(({ qty }) => qty > 0)
    : [];

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Sale Return"
        subtitle="Process a customer return and issue a credit note"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Source Invoice" columns={1}>
        <div className="flex items-end gap-2">
          <Input
            label="Invoice ID *"
            type="number"
            value={invoiceId}
            onChange={(e) => {
              setInvoiceId(e.target.value);
              setReturnQtys({});
            }}
            wrapperClassName="flex-1"
          />
          <Button
            variant="outline"
            disabled={!invoiceId}
            isLoading={loadingInvoice}
            onClick={() => setLoadedInvoiceId(Number(invoiceId))}
          >
            Load Invoice
          </Button>
        </div>

        {invoice && (
          <div className="border border-default rounded-lg p-3 space-y-2">
            <p className="text-xs text-secondary">Select quantity to return per line:</p>
            {invoice.lines.map((l) => (
              <div key={l.id} className="grid grid-cols-3 gap-2 items-center text-sm">
                <span>
                  Item #{l.itemId} ({l.quantity} @ {formatCurrency(parseFloat(l.unitPrice))})
                </span>
                <Input
                  type="number"
                  min="0"
                  max={l.quantity}
                  step="0.001"
                  placeholder="0"
                  value={returnQtys[l.id] ?? ''}
                  onChange={(e) => setReturnQtys((prev) => ({ ...prev, [l.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
      </ERPFormSection>

      <ERPFormSection title="Return Details" columns={2}>
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
          options={[
            { value: 'DEFECTIVE', label: 'Defective' },
            { value: 'WRONG_ITEM', label: 'Wrong Item' },
            { value: 'CUSTOMER_CHANGE_MIND', label: 'Customer Changed Mind' },
            { value: 'QUALITY_ISSUE', label: 'Quality Issue' },
            { value: 'OTHER', label: 'Other' },
          ]}
        />
        <div className="sm:col-span-2">
          <ERPSwitch
            label="Physical Return"
            description="Stock will be restored to warehouse"
            checked={isPhysical}
            onChange={setIsPhysical}
          />
        </div>
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          isLoading={createMutation.isPending}
          disabled={!invoice || selectedLines.length === 0}
          onClick={() =>
            invoice &&
            createMutation.mutate({
              invoiceId: invoice.id,
              customerId: invoice.customerId,
              branchId: invoice.branchId,
              returnDate: new Date(returnDate).toISOString(),
              reason,
              isPhysicalReturn: isPhysical,
              lines: selectedLines.map(({ line, qty }) => ({
                invoiceLineId: line.id,
                itemId: line.itemId,
                returnQty: qty,
              })),
            })
          }
        >
          Create Return
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
