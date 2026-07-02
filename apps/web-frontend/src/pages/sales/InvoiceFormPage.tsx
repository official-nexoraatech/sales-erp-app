import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { invoiceApi, quotationApi, itemApi, customerApi, warehouseApi, branchApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';

interface LineItem {
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  gstRate: number;
  hsnCode: string;
  taxableAmount: number;
  lineTotal: number;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function computeLine(l: LineItem, sellerState: string, placeOfSupply: string) {
  const subtotal = round2(l.unitPrice * l.quantity);
  const discount = round2(subtotal * l.discountPct / 100);
  const taxable = round2(subtotal - discount);
  const isIntra = sellerState === placeOfSupply;
  const cgstR = isIntra ? l.gstRate / 2 : 0;
  const sgstR = isIntra ? l.gstRate / 2 : 0;
  const igstR = isIntra ? 0 : l.gstRate;
  const cgst = round2(taxable * cgstR / 100);
  const sgst = round2(taxable * sgstR / 100);
  const igst = round2(taxable * igstR / 100);
  return { taxable, cgst, sgst, igst, lineTotal: round2(taxable + cgst + sgst + igst) };
}

export default function InvoiceFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const quotationId = searchParams.get('quotationId');

  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('27');
  const [sellerState, setSellerState] = useState('27');
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [dueDate, setDueDate] = useState<string>(new Date(Date.now() + 30 * 86400_000).toISOString().substring(0, 10));
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: itemData } = useQuery({
    queryKey: ['item-search', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch }),
    enabled: itemSearch.length > 1,
  });
  const { data: customerData } = useQuery({ queryKey: ['customers-list'], queryFn: () => customerApi.list({}) });
  const { data: warehouseData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehouseApi.list() });
  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list() });
  const { data: quotData } = useQuery({
    queryKey: ['quotation-detail', quotationId],
    queryFn: () => quotationApi.getById(Number(quotationId)),
    enabled: !!quotationId,
  });

  useEffect(() => {
    if (!quotData) return;
    const q = (quotData as { data?: { customerId?: number; placeOfSupply?: string; lines?: Array<{ itemId: number; quantity: string; unitPrice: string; discountPct: string; gstRate: string; hsnCode?: string }> } })?.data;
    if (q) {
      setCustomerId(String(q.customerId ?? ''));
      setPlaceOfSupply(q.placeOfSupply ?? '27');
      setLines((q.lines ?? []).map((l) => ({
        itemId: l.itemId,
        itemName: `Item ${l.itemId}`,
        quantity: parseFloat(l.quantity),
        unitPrice: parseFloat(l.unitPrice),
        discountPct: parseFloat(l.discountPct ?? '0'),
        gstRate: parseFloat(l.gstRate ?? '18'),
        hsnCode: l.hsnCode ?? '',
        taxableAmount: 0,
        lineTotal: 0,
      })));
    }
  }, [quotData]);

  const itemOptions = ((itemData as { data?: Array<{ id: number; name: string; gstRate?: number; hsnCode?: string; minSalePrice?: string }> })?.data ?? []);
  const customers = (customerData as { data?: Array<{ id: number; displayName: string }> })?.data ?? [];
  const warehouses = (warehouseData as { data?: Array<{ id: number; name: string }> })?.data ?? [];
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const computedLines = lines.map((l) => {
    const g = computeLine(l, sellerState, placeOfSupply);
    return { ...l, ...g };
  });

  const totals = computedLines.reduce(
    (acc, l) => ({
      subtotal: round2(acc.subtotal + l.unitPrice * l.quantity),
      discount: round2(acc.discount + l.unitPrice * l.quantity * l.discountPct / 100),
      taxable: round2(acc.taxable + l.taxable),
      cgst: round2(acc.cgst + l.cgst),
      sgst: round2(acc.sgst + l.sgst),
      igst: round2(acc.igst + l.igst),
      grand: round2(acc.grand + l.lineTotal),
    }),
    { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0 }
  );

  const addItem = (item: { id: number; name: string; gstRate?: number; hsnCode?: string }) => {
    setLines((prev) => [...prev, {
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      unitPrice: 0,
      discountPct: 0,
      gstRate: item.gstRate ?? 18,
      hsnCode: item.hsnCode ?? '',
      taxableAmount: 0,
      lineTotal: 0,
    }]);
    setItemSearch('');
  };

  const updateLine = (idx: number, field: keyof LineItem, value: number | string) => {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => invoiceApi.create(data),
    onSuccess: (data: unknown) => {
      const result = data as { data?: { id?: number } };
      toast.success('Invoice created');
      navigate(`/sales/invoices/${result?.data?.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (): void => {
    if (!customerId || !branchId || !warehouseId || lines.length === 0) {
      toast.error('Fill all required fields and add at least one item');
      return;
    }

    createMutation.mutate({
      customerId: Number(customerId),
      branchId: Number(branchId),
      warehouseId: Number(warehouseId),
      placeOfSupply,
      sellerStateCode: sellerState,
      invoiceDate: new Date(invoiceDate).toISOString(),
      dueDate: new Date(dueDate).toISOString(),
      notes,
      quotationId: quotationId ? Number(quotationId) : undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        gstRate: l.gstRate,
        hsnCode: l.hsnCode || undefined,
        discountAmount: 0,
      })),
    });
  };

  return (
    <div>
      <ERPPageHeader variant="list" title="New Invoice" subtitle="Create a new sales invoice" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Select
          label="Customer *"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          options={[{ value: '', label: 'Select customer...' }, ...customers.map((c) => ({ value: String(c.id), label: c.displayName }))]}
        />
        <Select
          label="Branch *"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={[{ value: '', label: 'Select branch...' }, ...branches.map((b) => ({ value: String(b.id), label: b.name }))]}
        />
        <Select
          label="Warehouse *"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={[{ value: '', label: 'Select warehouse...' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]}
        />
        <Input label="Invoice Date *" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        <Input label="Due Date *" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <Select
          label="Place of Supply *"
          value={placeOfSupply}
          onChange={(e) => setPlaceOfSupply(e.target.value)}
          options={[
            { value: '', label: 'Select state…' },
            ...INDIAN_STATES.map((s) => ({ value: s.gstCode, label: `${s.gstCode} – ${s.name}` })),
          ]}
        />
      </div>

      {/* Line Items */}
      <div className="bg-surface-card rounded-xl border border-default p-4 mb-4">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Search items to add..."
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            className="flex-1 rounded-lg border border-default bg-surface-card px-3 py-2 text-sm"
          />
        </div>
        {itemSearch.length > 1 && itemOptions.length > 0 && (
          <div className="border border-default rounded-lg mb-4 max-h-40 overflow-y-auto">
            {itemOptions.map((item) => (
              <button
                key={item.id}
                onClick={() => addItem(item)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-raised"
              >
                {item.name} — GST {item.gstRate ?? 18}%
              </button>
            ))}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary border-b border-default">
              <th className="pb-2">Item</th>
              <th className="pb-2">Qty</th>
              <th className="pb-2">Price</th>
              <th className="pb-2">Disc %</th>
              <th className="pb-2">GST %</th>
              <th className="pb-2">Taxable</th>
              <th className="pb-2">Total</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-700">
            {computedLines.map((l, idx) => (
              <tr key={idx}>
                <td className="py-2 pr-2">{l.itemName}</td>
                <td className="py-2 pr-2">
                  <input type="number" min="0.001" step="0.001" value={l.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-20 rounded border-default bg-surface-card px-2 py-1 text-sm" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min="0" step="0.01" value={l.unitPrice}
                    onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                    className="w-24 rounded border-default bg-surface-card px-2 py-1 text-sm" />
                </td>
                <td className="py-2 pr-2">
                  <input type="number" min="0" max="100" step="0.01" value={l.discountPct}
                    onChange={(e) => updateLine(idx, 'discountPct', parseFloat(e.target.value) || 0)}
                    className="w-16 rounded border-default bg-surface-card px-2 py-1 text-sm" />
                </td>
                <td className="py-2 pr-2 text-secondary">{l.gstRate}%</td>
                <td className="py-2 pr-2 text-right">₹{l.taxable.toFixed(2)}</td>
                <td className="py-2 pr-2 text-right font-semibold">₹{l.lineTotal.toFixed(2)}</td>
                <td className="py-2">
                  <button onClick={() => removeLine(idx)} className="text-danger hover:text-danger text-xs">✕</button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-disabled text-sm">No items added yet</td></tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        {lines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-default flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-secondary">Subtotal</span><span>₹{totals.subtotal.toFixed(2)}</span></div>
              {totals.discount > 0 && <div className="flex justify-between text-danger"><span>Discount</span><span>-₹{totals.discount.toFixed(2)}</span></div>}
              <div className="flex justify-between"><span className="text-secondary">Taxable Amount</span><span>₹{totals.taxable.toFixed(2)}</span></div>
              {totals.cgst > 0 && <div className="flex justify-between"><span className="text-secondary">CGST</span><span>₹{totals.cgst.toFixed(2)}</span></div>}
              {totals.sgst > 0 && <div className="flex justify-between"><span className="text-secondary">SGST</span><span>₹{totals.sgst.toFixed(2)}</span></div>}
              {totals.igst > 0 && <div className="flex justify-between"><span className="text-secondary">IGST</span><span>₹{totals.igst.toFixed(2)}</span></div>}
              <div className="flex justify-between font-bold text-base pt-1 border-t border-default">
                <span>Grand Total</span><span>₹{totals.grand.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-6">
        <ERPTextarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Any additional notes for this invoice…" />
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => navigate('/sales/invoices')}>Cancel</Button>
        <Button isLoading={createMutation.isPending} onClick={handleSubmit}>Save as Draft</Button>
      </div>
    </div>
  );
}
