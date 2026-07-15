import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { purchaseOrderApi, itemApi, warehouseApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Kbd from '../../components/erp/Kbd.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { INDIAN_STATES } from '../../lib/indianStates.js';
import { createSearchLoadOptions } from '../../lib/searchSelectOptions.js';

const loadSupplierOptions = createSearchLoadOptions('supplier');
const ITEM_SEARCH_ID = 'po-item-search';

interface LineItem {
  itemId: number;
  itemName: string;
  hsnCode: string;
  orderedQty: number;
  unitPrice: number;
  discountPct: number;
  gstRate: number;
  taxableAmount: number;
  lineTotal: number;
}

interface ItemPickOption extends AsyncSelectOption {
  gstRate?: string | undefined;
  hsnCode?: string | undefined;
  purchasePrice?: string | undefined;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function computeLine(l: LineItem, sellerState: string, placeOfSupply: string) {
  const subtotal = round2(l.unitPrice * l.orderedQty);
  const discount = round2((subtotal * l.discountPct) / 100);
  const taxable = round2(subtotal - discount);
  const isIntra = sellerState === placeOfSupply;
  const cgst = isIntra ? round2((taxable * l.gstRate) / 2 / 100) : 0;
  const sgst = isIntra ? round2((taxable * l.gstRate) / 2 / 100) : 0;
  const igst = isIntra ? 0 : round2((taxable * l.gstRate) / 100);
  return { taxable, cgst, sgst, igst, lineTotal: round2(taxable + cgst + sgst + igst) };
}

export default function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewItems = hasPermission(PERMISSIONS.ITEM_VIEW);

  const [selectedSupplier, setSelectedSupplier] = useState<AsyncSelectOption | null>(null);
  const supplierId = selectedSupplier ? String(selectedSupplier.value) : '';
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [placeOfSupply, setPlaceOfSupply] = useState('27');
  const [sellerState, setSellerState] = useState('27');
  const [poDate, setPoDate] = useState<string>(new Date().toISOString().substring(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState<string>(
    new Date(Date.now() + 14 * 86400_000).toISOString().substring(0, 10)
  );
  const [notes, setNotes] = useState('');
  const [termsAndConditions, setTermsAndConditions] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemPick, setItemPick] = useState<ItemPickOption | null>(null);

  const { data: warehouseData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });
  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });

  const warehouses =
    (warehouseData as { content?: Array<{ id: number; name: string }> })?.content ?? [];
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const loadItemOptions = useCallback(
    async (query: string): Promise<ItemPickOption[]> => {
      if (!canViewItems) return [];
      const res = await itemApi.list({ search: query });
      const content =
        (
          res as {
            content?: Array<{
              id: number;
              name: string;
              itemCode?: string;
              gstRate?: string;
              hsnCode?: string;
              purchasePrice?: string;
            }>;
          }
        )?.content ?? [];
      return content.map((item) => ({
        value: item.id,
        label: item.name,
        sublabel: [
          item.itemCode,
          item.hsnCode ? `HSN ${item.hsnCode}` : undefined,
          `GST ${item.gstRate ?? 18}%`,
        ]
          .filter(Boolean)
          .join(' · '),
        gstRate: item.gstRate,
        hsnCode: item.hsnCode,
        purchasePrice: item.purchasePrice,
      }));
    },
    [canViewItems]
  );

  const computedLines = lines.map((l) => ({ ...l, ...computeLine(l, sellerState, placeOfSupply) }));

  const totals = computedLines.reduce(
    (acc, l) => ({
      subtotal: round2(acc.subtotal + l.unitPrice * l.orderedQty),
      discount: round2(acc.discount + (l.unitPrice * l.orderedQty * l.discountPct) / 100),
      taxable: round2(acc.taxable + l.taxable),
      cgst: round2(acc.cgst + l.cgst),
      sgst: round2(acc.sgst + l.sgst),
      igst: round2(acc.igst + l.igst),
      grand: round2(acc.grand + l.lineTotal),
    }),
    { subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0 }
  );

  const addItem = (item: ItemPickOption) => {
    setLines((prev) => [
      ...prev,
      {
        itemId: Number(item.value),
        itemName: item.label,
        hsnCode: item.hsnCode ?? '',
        orderedQty: 1,
        unitPrice: item.purchasePrice ? parseFloat(item.purchasePrice) : 0,
        discountPct: 0,
        gstRate: item.gstRate ? parseFloat(item.gstRate) : 18,
        taxableAmount: 0,
        lineTotal: 0,
      },
    ]);
  };

  const handlePickItem = (opt: ItemPickOption | null) => {
    if (opt) addItem(opt);
    setItemPick(null);
    // Combobox blurs itself on selection — refocus so scanning/typing the next item doesn't
    // need an extra click back into the search box, which matters for rapid successive adds.
    setTimeout(() => document.getElementById(ITEM_SEARCH_ID)?.focus(), 0);
  };

  const updateLine = (idx: number, field: keyof LineItem, value: number | string) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => purchaseOrderApi.create(data),
    onSuccess: () => {
      toast.success('Purchase order created as DRAFT');
      navigate('/purchase/orders');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!supplierId || !branchId || !warehouseId || lines.length === 0) {
      toast.error('Fill all required fields and add at least one item');
      return;
    }
    createMutation.mutate({
      supplierId: Number(supplierId),
      branchId: Number(branchId),
      warehouseId: Number(warehouseId),
      poDate: new Date(poDate).toISOString(),
      expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString(),
      placeOfSupply,
      sellerStateCode: sellerState,
      notes: notes || undefined,
      termsAndConditions: termsAndConditions || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        orderedQty: l.orderedQty,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        discountAmount: round2((l.unitPrice * l.orderedQty * l.discountPct) / 100),
        gstRate: l.gstRate,
        hsnCode: l.hsnCode || undefined,
      })),
    });
  };

  useKeyboardShortcut('Enter', handleSubmit, { ctrlOrCmd: true });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="New Purchase Order"
        subtitle="Create a purchase order for a supplier"
        backTo="/purchase/orders"
      />

      <ERPFormSection title="Supplier & Fulfillment" columns={3}>
        <ERPAsyncSelect
          label="Supplier"
          required
          value={selectedSupplier}
          onChange={setSelectedSupplier}
          loadOptions={loadSupplierOptions}
          placeholder="Type to search suppliers…"
        />
        <Select
          label="Branch"
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={[
            { value: '', label: 'Select branch…' },
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
        />
        <Select
          label="Warehouse"
          required
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={[
            { value: '', label: 'Select warehouse…' },
            ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
          ]}
        />
        <Input
          label="PO Date"
          required
          type="date"
          value={poDate}
          onChange={(e) => setPoDate(e.target.value)}
        />
        <Input
          label="Expected Delivery Date"
          type="date"
          value={expectedDeliveryDate}
          onChange={(e) => setExpectedDeliveryDate(e.target.value)}
        />
      </ERPFormSection>

      <ERPFormSection
        title="Tax Details"
        description="GST place of supply — usually set once per supplier and rarely changed."
        columns={2}
        className="mt-4"
      >
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
        <Select
          label="Seller State (Your State)"
          required
          value={sellerState}
          onChange={(e) => setSellerState(e.target.value)}
          options={[
            { value: '', label: 'Select state…' },
            ...INDIAN_STATES.map((s) => ({ value: s.gstCode, label: `${s.gstCode} – ${s.name}` })),
          ]}
        />
      </ERPFormSection>

      {/* Line Items + Order Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 items-start">
        <div className="lg:col-span-2 bg-surface-card rounded-xl border border-default p-4">
          <h3 className="text-sm font-semibold text-primary mb-3">Order Lines</h3>

          <div className="mb-4">
            <ERPAsyncSelect<ItemPickOption>
              id={ITEM_SEARCH_ID}
              label="Add Item"
              value={itemPick}
              onChange={handlePickItem}
              loadOptions={loadItemOptions}
              minChars={2}
              placeholder="Search items by name or code…"
            />
            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-secondary">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <span>to navigate</span>
              <Kbd>Enter</Kbd>
              <span>to add</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-default">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-subtle z-[1]">
                <tr className="text-left text-secondary text-xs uppercase tracking-wide">
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Qty
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Unit Price
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Disc %
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    GST %
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Taxable
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium text-right">
                    Total
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {computedLines.map((l, idx) => (
                  <tr key={idx} className="hover:bg-surface-subtle transition-colors">
                    <td className="px-3 py-2 text-primary">
                      <div className="font-medium">{l.itemName}</div>
                      {l.hsnCode && <div className="text-xs text-secondary">HSN {l.hsnCode}</div>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0.001"
                        step="1"
                        value={l.orderedQty}
                        onChange={(e) =>
                          updateLine(idx, 'orderedQty', parseFloat(e.target.value) || 0)
                        }
                        aria-label={`Quantity for ${l.itemName}`}
                        className="w-20 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={(e) =>
                          updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)
                        }
                        aria-label={`Unit price for ${l.itemName}`}
                        className="w-28 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        size="sm"
                        min="0"
                        max="100"
                        step="0.01"
                        value={l.discountPct}
                        onChange={(e) =>
                          updateLine(idx, 'discountPct', parseFloat(e.target.value) || 0)
                        }
                        aria-label={`Discount percent for ${l.itemName}`}
                        className="w-16 text-right ml-auto"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-secondary">{l.gstRate}%</td>
                    <td className="px-3 py-2 text-right text-primary">₹{l.taxable.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-primary">
                      ₹{l.lineTotal.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        aria-label={`Remove ${l.itemName}`}
                        className="p-1.5 rounded-md text-secondary hover:bg-danger-subtle hover:text-danger transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lines.length === 0 && (
              <ERPEmptyState
                type="no-data"
                title="No items added yet"
                description="Search for an item above to add it to this order."
              />
            )}
          </div>
        </div>

        {/* Order Summary */}
        <div className="lg:sticky lg:top-4">
          <div className="bg-surface-card rounded-xl border border-default p-5">
            <h3 className="text-sm font-semibold text-primary mb-4">Order Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-secondary">Subtotal</span>
                <span className="text-primary">₹{totals.subtotal.toFixed(2)}</span>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-danger">
                  <span>Discount</span>
                  <span>-₹{totals.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-secondary">Taxable Amount</span>
                <span className="text-primary">₹{totals.taxable.toFixed(2)}</span>
              </div>
              {totals.cgst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">CGST</span>
                  <span className="text-primary">₹{totals.cgst.toFixed(2)}</span>
                </div>
              )}
              {totals.sgst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">SGST</span>
                  <span className="text-primary">₹{totals.sgst.toFixed(2)}</span>
                </div>
              )}
              {totals.igst > 0 && (
                <div className="flex justify-between">
                  <span className="text-secondary">IGST</span>
                  <span className="text-primary">₹{totals.igst.toFixed(2)}</span>
                </div>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-default">
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1">
                Grand Total
              </p>
              <p className="text-3xl font-bold text-primary">₹{totals.grand.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      <ERPFormSection title="Additional Details" columns={2} className="mt-4">
        <ERPTextarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Any additional notes for this purchase order…"
        />
        <ERPTextarea
          label="Terms & Conditions"
          value={termsAndConditions}
          onChange={(e) => setTermsAndConditions(e.target.value)}
          rows={3}
          placeholder="Payment terms, delivery terms, etc."
        />
      </ERPFormSection>

      <ERPStickyFooter>
        <span className="hidden sm:flex items-center gap-1.5 text-xs text-secondary mr-auto">
          <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> to save
        </span>
        <Button variant="secondary" onClick={() => navigate('/purchase/orders')}>
          Cancel
        </Button>
        <Button isLoading={createMutation.isPending} onClick={handleSubmit}>
          Save as Draft
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
