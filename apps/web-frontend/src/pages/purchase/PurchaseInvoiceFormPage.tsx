import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { purchaseInvoiceApi, grnApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import { formatCurrency } from '../../lib/format.js';
import { toFieldErrors } from '../../lib/zodFieldErrors.js';
import { purchaseInvoiceFormSchema } from '../../schemas/purchase-transactions.schema.js';

interface GRNLine {
  id: number;
  itemId: number;
  itemName?: string;
  receivedQty: string;
  grnRate: string;
}

interface GRNOption extends AsyncSelectOption {
  purchaseOrderId?: number;
  supplierId?: number;
  branchId?: number;
  lines?: GRNLine[];
}

export default function PurchaseInvoiceFormPage() {
  const navigate = useNavigate();
  const [grn, setGrn] = useState<GRNOption | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [lineValues, setLineValues] = useState<Record<number, { qty: number; rate: number }>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const loadGrnOptions = useCallback(async (query: string): Promise<GRNOption[]> => {
    const res = await grnApi.list({ status: 'APPROVED', search: query || undefined });
    const content =
      (
        res as {
          content?: Array<{
            id: number;
            grnNumber: string | null;
            supplierName?: string;
            grandTotal: string;
          }>;
        }
      )?.content ?? [];
    return content.map((g) => ({
      value: g.id,
      label: g.grnNumber ?? `GRN-${g.id}`,
      sublabel: `${g.supplierName ?? ''} · ${formatCurrency(parseFloat(g.grandTotal))}`,
    }));
  }, []);

  const handlePickGrn = async (opt: AsyncSelectOption | null) => {
    if (!opt) {
      setGrn(null);
      return;
    }
    const detail = (await grnApi.getById(Number(opt.value))) as {
      purchaseOrderId: number;
      supplierId: number;
      branchId: number;
      lines: GRNLine[];
    };
    setGrn({ ...opt, ...detail });
    const initial: Record<number, { qty: number; rate: number }> = {};
    for (const l of detail.lines) {
      initial[l.id] = { qty: parseFloat(l.receivedQty), rate: parseFloat(l.grnRate) };
    }
    setLineValues(initial);
  };

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => purchaseInvoiceApi.create(data),
    onSuccess: () => {
      toast.success('Purchase invoice recorded');
      navigate('/purchase/invoices');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = purchaseInvoiceFormSchema.safeParse({
      grnId: grn ? Number(grn.value) : undefined,
      supplierInvoiceNumber,
      invoiceDate,
    });
    if (!result.success) {
      setFieldErrors(toFieldErrors(result.error));
      toast.error('Fix the highlighted fields before saving');
      return;
    }
    if (!grn?.lines) return;
    setFieldErrors({});
    createMutation.mutate({
      branchId: grn.branchId,
      supplierInvoiceNumber,
      supplierId: grn.supplierId,
      purchaseOrderId: grn.purchaseOrderId,
      grnId: Number(grn.value),
      invoiceDate: new Date(invoiceDate).toISOString(),
      lines: grn.lines.map((l) => ({
        grnLineId: l.id,
        invoicedQty: lineValues[l.id]?.qty ?? parseFloat(l.receivedQty),
        invoicedRate: lineValues[l.id]?.rate ?? parseFloat(l.grnRate),
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ERPPageHeader
        variant="detail"
        title="Record Purchase Invoice"
        subtitle="Capture what the supplier actually billed and flag any variance against the GRN"
        backTo="/purchase/invoices"
      />

      <ERPFormSection title="Invoice Details" columns={3}>
        <ERPAsyncSelect
          label="GRN (Approved)"
          required
          value={grn}
          onChange={handlePickGrn}
          loadOptions={loadGrnOptions}
          placeholder="Search approved GRNs…"
          error={fieldErrors.grnId}
        />
        <Input
          label="Supplier Invoice Number"
          required
          value={supplierInvoiceNumber}
          onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
          error={fieldErrors.supplierInvoiceNumber}
        />
        <Input
          label="Invoice Date"
          type="date"
          required
          value={invoiceDate}
          onChange={(e) => setInvoiceDate(e.target.value)}
          error={fieldErrors.invoiceDate}
        />
      </ERPFormSection>

      {grn?.lines && (
        <div className="bg-surface-card rounded-xl border border-default p-4 mt-4">
          <h3 className="text-sm font-semibold text-primary mb-3">
            Lines — pre-filled from the GRN, edit to match what the supplier's invoice actually says
          </h3>
          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-subtle">
                <tr className="text-left text-secondary text-xs uppercase tracking-wide">
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    GRN Qty / Rate
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Invoiced Qty
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Invoiced Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {grn.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2 text-primary font-medium">
                      {l.itemName ?? `Item ${l.itemId}`}
                    </td>
                    <td className="px-3 py-2 text-right text-secondary">
                      {l.receivedQty} @ {formatCurrency(parseFloat(l.grnRate))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        step="0.001"
                        value={lineValues[l.id]?.qty ?? parseFloat(l.receivedQty)}
                        onChange={(e) =>
                          setLineValues((prev) => ({
                            ...prev,
                            [l.id]: { ...prev[l.id]!, qty: parseFloat(e.target.value) || 0 },
                          }))
                        }
                        aria-label={`Invoiced quantity for ${l.itemName}`}
                        className="w-24 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        step="0.01"
                        value={lineValues[l.id]?.rate ?? parseFloat(l.grnRate)}
                        onChange={(e) =>
                          setLineValues((prev) => ({
                            ...prev,
                            [l.id]: { ...prev[l.id]!, rate: parseFloat(e.target.value) || 0 },
                          }))
                        }
                        aria-label={`Invoiced rate for ${l.itemName}`}
                        className="w-24 text-right ml-auto"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ERPStickyFooter>
        <Button type="button" variant="secondary" onClick={() => navigate('/purchase/invoices')}>
          Cancel
        </Button>
        <Button type="submit" isLoading={createMutation.isPending} disabled={!grn}>
          Record Invoice
        </Button>
      </ERPStickyFooter>
    </form>
  );
}
