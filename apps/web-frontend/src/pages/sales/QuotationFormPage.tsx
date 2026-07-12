import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { quotationApi, itemApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import { createSearchLoadOptions } from '../../lib/searchSelectOptions.js';
import { friendlyApiErrorMessage } from '../../lib/errorMessages.js';
import type { ApiError } from '../../api/client.js';

const loadCustomerOptions = createSearchLoadOptions('customer');

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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function computeLine(l: LineItem, sellerState: string, placeOfSupply: string) {
  const subtotal = round2(l.unitPrice * l.quantity);
  const discount = round2((subtotal * l.discountPct) / 100);
  const taxable = round2(subtotal - discount);
  const isIntra = sellerState === placeOfSupply;
  const cgstR = isIntra ? l.gstRate / 2 : 0;
  const sgstR = isIntra ? l.gstRate / 2 : 0;
  const igstR = isIntra ? 0 : l.gstRate;
  const cgst = round2((taxable * cgstR) / 100);
  const sgst = round2((taxable * sgstR) / 100);
  const igst = round2((taxable * igstR) / 100);
  return { taxable, cgst, sgst, igst, lineTotal: round2(taxable + cgst + sgst + igst) };
}

export default function QuotationFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [selectedCustomer, setSelectedCustomer] = useState<AsyncSelectOption | null>(null);
  const customerId = selectedCustomer ? String(selectedCustomer.value) : '';
  const [branchId, setBranchId] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('27');
  const [sellerState] = useState('27');
  const [validUntil, setValidUntil] = useState<string>(
    new Date(Date.now() + 15 * 86400_000).toISOString().substring(0, 10)
  );
  const [notes, setNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemSearch, setItemSearch] = useState('');

  const { data: itemData } = useQuery({
    queryKey: ['item-search', itemSearch],
    queryFn: () => itemApi.list({ search: itemSearch }),
    enabled: itemSearch.length > 1 && hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });

  const itemOptions =
    (
      itemData as {
        content?: Array<{
          id: number;
          name: string;
          gstRate?: number;
          hsnCode?: string;
          minSalePrice?: string;
        }>;
      }
    )?.content ?? [];
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const computedLines = lines.map((l) => {
    const g = computeLine(l, sellerState, placeOfSupply);
    return { ...l, ...g };
  });

  const totals = computedLines.reduce(
    (acc, l) => ({
      subtotal: round2(acc.subtotal + l.unitPrice * l.quantity),
      discount: round2(acc.discount + (l.unitPrice * l.quantity * l.discountPct) / 100),
      taxable: round2(acc.taxable + l.taxable),
      cgst: round2(acc.cgst + l.cgst),
      sgst: round2(acc.sgst + l.sgst),
      igst: round2(acc.igst + l.igst),
      grand: round2(acc.grand + l.lineTotal),
    }),
    { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0 }
  );

  const addItem = (item: { id: number; name: string; gstRate?: number; hsnCode?: string }) => {
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        itemName: item.name,
        quantity: 1,
        unitPrice: 0,
        discountPct: 0,
        gstRate: item.gstRate ?? 18,
        hsnCode: item.hsnCode ?? '',
        taxableAmount: 0,
        lineTotal: 0,
      },
    ]);
    setItemSearch('');
  };

  const updateLine = (idx: number, field: keyof LineItem, value: number | string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => quotationApi.create(data),
    onSuccess: (data: unknown) => {
      const result = data as { id?: number };
      toast.success('Quotation created');
      navigate(`/sales/quotations/${result?.id}`);
    },
    onError: (e: ApiError) =>
      toast.error(
        friendlyApiErrorMessage(e, {
          items: lines.map((l) => ({ id: l.itemId, name: l.itemName })),
          ...(selectedCustomer?.label !== undefined
            ? { customerName: selectedCustomer.label }
            : {}),
        })
      ),
  });

  const handleSubmit = (): void => {
    if (!customerId || !branchId || lines.length === 0) {
      toast.error('Fill all required fields and add at least one item');
      return;
    }

    createMutation.mutate({
      customerId: Number(customerId),
      branchId: Number(branchId),
      placeOfSupply,
      sellerStateCode: sellerState,
      validUntil: new Date(validUntil).toISOString(),
      notes: notes || undefined,
      termsAndConditions: termsAndConditions || undefined,
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
      <ERPPageHeader
        variant="list"
        title="New Quotation"
        subtitle="Create a new customer quotation"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <ERPAsyncSelect
          label="Customer"
          value={selectedCustomer}
          onChange={setSelectedCustomer}
          loadOptions={loadCustomerOptions}
          placeholder="Type to search customers…"
          required
        />
        <Select
          label="Branch"
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={[
            { value: '', label: 'Select branch...' },
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
        />
        <Input
          label="Valid Until"
          required
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
        />
        <Select
          label="Place of Supply"
          required
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

        <div className="overflow-x-auto">
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
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                      className="w-20 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.unitPrice}
                      onChange={(e) =>
                        updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)
                      }
                      className="w-24 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={l.discountPct}
                      onChange={(e) =>
                        updateLine(idx, 'discountPct', parseFloat(e.target.value) || 0)
                      }
                      className="w-16 rounded border-default bg-surface-card px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2 text-secondary">{l.gstRate}%</td>
                  <td className="py-2 pr-2 text-right">₹{l.taxable.toFixed(2)}</td>
                  <td className="py-2 pr-2 text-right font-semibold">₹{l.lineTotal.toFixed(2)}</td>
                  <td className="py-2">
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-danger hover:text-danger text-xs"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-disabled text-sm">
                    No items added yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        {lines.length > 0 && (
          <div className="mt-4 pt-4 border-t border-default flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-secondary">Subtotal</span>
                <span>₹{totals.subtotal.toFixed(2)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-danger">
                  <span>Discount</span>
                  <span>-₹{totals.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-secondary">Taxable Amount</span>
                <span>₹{totals.taxable.toFixed(2)}</span>
              </div>
              {totals.cgst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">CGST</span>
                  <span>₹{totals.cgst.toFixed(2)}</span>
                </div>
              )}
              {totals.sgst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">SGST</span>
                  <span>₹{totals.sgst.toFixed(2)}</span>
                </div>
              )}
              {totals.igst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">IGST</span>
                  <span>₹{totals.igst.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1 border-t border-default">
                <span>Grand Total</span>
                <span>₹{totals.grand.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ERPTextarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes for this quotation…"
        />
        <ERPTextarea
          label="Terms & Conditions"
          value={termsAndConditions}
          onChange={(e) => setTermsAndConditions(e.target.value)}
          rows={3}
          placeholder="Payment terms, delivery terms, etc…"
        />
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => navigate('/sales/quotations')}>
          Cancel
        </Button>
        <Button isLoading={createMutation.isPending} onClick={handleSubmit}>
          Save as Draft
        </Button>
      </div>
    </div>
  );
}
