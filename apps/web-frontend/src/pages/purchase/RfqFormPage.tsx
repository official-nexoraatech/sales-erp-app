import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2, X } from 'lucide-react';
import { rfqApi, itemApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPTextarea from '../../components/erp/ERPTextarea.js';
import ERPAsyncSelect, { type AsyncSelectOption } from '../../components/erp/ERPAsyncSelect.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { createSearchLoadOptions } from '../../lib/searchSelectOptions.js';
import { toFieldErrors } from '../../lib/zodFieldErrors.js';
import { rfqFormSchema } from '../../schemas/purchase-transactions.schema.js';

const loadSupplierOptions = createSearchLoadOptions('supplier');

interface LineItem {
  itemId: number;
  itemName: string;
  qty: number;
}

export default function RfqFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewItems = hasPermission(PERMISSIONS.ITEM_VIEW);

  const [branchId, setBranchId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemPick, setItemPick] = useState<AsyncSelectOption | null>(null);
  const [suppliers, setSuppliers] = useState<AsyncSelectOption[]>([]);
  const [supplierPick, setSupplierPick] = useState<AsyncSelectOption | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const branches = (branchData as { content?: Array<{ id: number; name: string }> })?.content ?? [];

  const loadItemOptions = useCallback(
    async (query: string): Promise<AsyncSelectOption[]> => {
      if (!canViewItems) return [];
      const res = await itemApi.list({ search: query });
      const content =
        (res as { content?: Array<{ id: number; name: string; itemCode?: string }> })?.content ??
        [];
      return content.map((item) => ({
        value: item.id,
        label: item.name,
        ...(item.itemCode ? { sublabel: item.itemCode } : {}),
      }));
    },
    [canViewItems]
  );

  const addItem = (item: AsyncSelectOption | null) => {
    if (!item) return;
    setLines((prev) => [...prev, { itemId: Number(item.value), itemName: item.label, qty: 1 }]);
    setItemPick(null);
  };

  const updateLine = (idx: number, qty: number) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qty } : l)));

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const addSupplier = (opt: AsyncSelectOption | null) => {
    if (opt && !suppliers.some((s) => s.value === opt.value))
      setSuppliers((prev) => [...prev, opt]);
    setSupplierPick(null);
  };

  const removeSupplier = (value: string | number) =>
    setSuppliers((prev) => prev.filter((s) => s.value !== value));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => rfqApi.create(data),
    onSuccess: () => {
      toast.success('RFQ created');
      navigate('/purchase/rfqs');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = rfqFormSchema.safeParse({
      branchId: branchId ? Number(branchId) : undefined,
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })),
    });
    if (!result.success) {
      setFieldErrors(toFieldErrors(result.error));
      toast.error('Fix the highlighted fields before saving');
      return;
    }
    setFieldErrors({});
    createMutation.mutate({
      branchId: Number(branchId),
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      notes: notes || undefined,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
      supplierIds: suppliers.map((s) => Number(s.value)),
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ERPPageHeader
        variant="detail"
        title="New RFQ"
        subtitle="Request quotations from one or more suppliers"
        backTo="/purchase/rfqs"
      />

      <ERPFormSection title="RFQ Details" columns={2}>
        <Select
          label="Branch"
          required
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          error={fieldErrors.branchId}
          options={[
            { value: '', label: 'Select branch…' },
            ...branches.map((b) => ({ value: String(b.id), label: b.name })),
          ]}
        />
        <Input
          label="Due Date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <ERPTextarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Additional context for suppliers…"
        />
      </ERPFormSection>

      <div className="bg-surface-card rounded-xl border border-default p-4 mt-4">
        <h3 className="text-sm font-semibold text-primary mb-3">Invite Suppliers</h3>
        <ERPAsyncSelect
          value={supplierPick}
          onChange={addSupplier}
          loadOptions={loadSupplierOptions}
          placeholder="Type to search suppliers to invite…"
        />
        {suppliers.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {suppliers.map((s) => (
              <span
                key={s.value}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-subtle border border-default text-xs text-primary"
              >
                {s.label}
                <button
                  type="button"
                  onClick={() => removeSupplier(s.value)}
                  aria-label={`Remove ${s.label}`}
                  className="hover:text-danger"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-surface-card rounded-xl border border-default p-4 mt-4">
        <h3 className="text-sm font-semibold text-primary mb-3">Items Requested</h3>
        <ERPAsyncSelect
          value={itemPick}
          onChange={addItem}
          loadOptions={loadItemOptions}
          minChars={2}
          placeholder="Search items by name or code…"
        />
        {fieldErrors.lines && (
          <p className="text-xs text-danger mt-2" role="alert">
            {fieldErrors.lines}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-default mt-4">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-secondary text-xs uppercase tracking-wide">
                <th scope="col" className="px-3 py-2.5 font-medium">
                  Item
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium text-right">
                  Qty
                </th>
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2 text-primary font-medium">{l.itemName}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      size="sm"
                      min="0.001"
                      step="1"
                      value={l.qty}
                      onChange={(e) => updateLine(idx, parseFloat(e.target.value) || 0)}
                      aria-label={`Quantity for ${l.itemName}`}
                      error={fieldErrors[`lines.${idx}.quantity`]}
                      className="w-20 text-right ml-auto"
                    />
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
              description="Search for an item above to add it to this RFQ."
            />
          )}
        </div>
      </div>

      <ERPStickyFooter>
        <Button type="button" variant="secondary" onClick={() => navigate('/purchase/rfqs')}>
          Cancel
        </Button>
        <Button type="submit" isLoading={createMutation.isPending}>
          Create RFQ
        </Button>
      </ERPStickyFooter>
    </form>
  );
}
