import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { requisitionApi, itemApi, branchApi } from '../../api/endpoints.js';
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
import { toFieldErrors } from '../../lib/zodFieldErrors.js';
import { requisitionFormSchema } from '../../schemas/purchase-transactions.schema.js';

interface LineItem {
  itemId: number;
  itemName: string;
  requestedQty: number;
  estimatedUnitPrice: number;
}

interface ItemPickOption extends AsyncSelectOption {
  purchasePrice?: string | undefined;
}

export default function RequisitionFormPage() {
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewItems = hasPermission(PERMISSIONS.ITEM_VIEW);

  const [branchId, setBranchId] = useState('');
  const [department, setDepartment] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [requiredByDate, setRequiredByDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [itemPick, setItemPick] = useState<ItemPickOption | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
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
              purchasePrice?: string;
            }>;
          }
        )?.content ?? [];
      return content.map((item) => ({
        value: item.id,
        label: item.name,
        ...(item.itemCode ? { sublabel: item.itemCode } : {}),
        ...(item.purchasePrice ? { purchasePrice: item.purchasePrice } : {}),
      }));
    },
    [canViewItems]
  );

  const addItem = (item: ItemPickOption) => {
    setLines((prev) => [
      ...prev,
      {
        itemId: Number(item.value),
        itemName: item.label,
        requestedQty: 1,
        estimatedUnitPrice: item.purchasePrice ? parseFloat(item.purchasePrice) : 0,
      },
    ]);
  };

  const handlePickItem = (opt: ItemPickOption | null) => {
    if (opt) addItem(opt);
    setItemPick(null);
  };

  const updateLine = (idx: number, field: keyof LineItem, value: number) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const estimatedTotal = lines.reduce((sum, l) => sum + l.requestedQty * l.estimatedUnitPrice, 0);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => requisitionApi.create(data),
    onSuccess: () => {
      toast.success('Requisition created as DRAFT');
      navigate('/purchase/requisitions');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = requisitionFormSchema.safeParse({
      branchId: branchId ? Number(branchId) : undefined,
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.requestedQty })),
    });
    if (!result.success) {
      setFieldErrors(toFieldErrors(result.error));
      toast.error('Fix the highlighted fields before saving');
      return;
    }
    setFieldErrors({});
    createMutation.mutate({
      branchId: Number(branchId),
      department: department || undefined,
      priority,
      requiredByDate: requiredByDate ? new Date(requiredByDate).toISOString() : undefined,
      notes: notes || undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        requestedQty: l.requestedQty,
        estimatedUnitPrice: l.estimatedUnitPrice,
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <ERPPageHeader
        variant="detail"
        title="New Purchase Requisition"
        subtitle="Request goods before an RFQ or Purchase Order is raised"
        backTo="/purchase/requisitions"
      />

      <ERPFormSection title="Request Details" columns={3}>
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
          label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="e.g. Production, Retail"
        />
        <Select
          label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          options={[
            { value: 'LOW', label: 'Low' },
            { value: 'MEDIUM', label: 'Medium' },
            { value: 'HIGH', label: 'High' },
            { value: 'URGENT', label: 'Urgent' },
          ]}
        />
        <Input
          label="Required By"
          type="date"
          value={requiredByDate}
          onChange={(e) => setRequiredByDate(e.target.value)}
        />
      </ERPFormSection>

      <div className="bg-surface-card rounded-xl border border-default p-4 mt-4">
        <h3 className="text-sm font-semibold text-primary mb-3">Requested Items</h3>
        <ERPAsyncSelect<ItemPickOption>
          label="Add Item"
          value={itemPick}
          onChange={handlePickItem}
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
                <th scope="col" className="px-3 py-2.5 font-medium text-right">
                  Est. Unit Price
                </th>
                <th scope="col" className="px-3 py-2.5 font-medium text-right">
                  Est. Total
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
                      value={l.requestedQty}
                      onChange={(e) =>
                        updateLine(idx, 'requestedQty', parseFloat(e.target.value) || 0)
                      }
                      aria-label={`Quantity for ${l.itemName}`}
                      error={fieldErrors[`lines.${idx}.quantity`]}
                      className="w-20 text-right ml-auto"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      size="sm"
                      min="0"
                      step="0.01"
                      value={l.estimatedUnitPrice}
                      onChange={(e) =>
                        updateLine(idx, 'estimatedUnitPrice', parseFloat(e.target.value) || 0)
                      }
                      aria-label={`Estimated unit price for ${l.itemName}`}
                      className="w-28 text-right ml-auto"
                    />
                  </td>
                  <td className="px-3 py-2 text-right text-primary">
                    ₹{(l.requestedQty * l.estimatedUnitPrice).toFixed(2)}
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
              description="Search for an item above to add it to this requisition."
            />
          )}
        </div>
        {lines.length > 0 && (
          <div className="flex justify-end mt-3 text-sm">
            <span className="text-secondary mr-2">Estimated Total:</span>
            <span className="font-semibold text-primary">₹{estimatedTotal.toFixed(2)}</span>
          </div>
        )}
      </div>

      <ERPFormSection title="Notes" columns={1} className="mt-4">
        <ERPTextarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Justification or additional context for this requisition…"
        />
      </ERPFormSection>

      <ERPStickyFooter>
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate('/purchase/requisitions')}
        >
          Cancel
        </Button>
        <Button type="submit" isLoading={createMutation.isPending}>
          Save as Draft
        </Button>
      </ERPStickyFooter>
    </form>
  );
}
