import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { itemApi } from '../../api/endpoints.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import Input from '../../components/ui/Input.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';

interface Variant {
  id: number;
  sku: string;
  barcode?: string;
  attributeCombination: Record<string, string>;
  mrp?: string;
  salePrice: string;
  purchasePrice: string;
  isActive: boolean;
  version: number;
}

interface VariantFormState {
  sku: string;
  attributes: string;
  barcode: string;
  mrp: string;
  salePrice: string;
  purchasePrice: string;
}

const EMPTY_FORM: VariantFormState = {
  sku: '',
  attributes: '',
  barcode: '',
  mrp: '',
  salePrice: '',
  purchasePrice: '',
};

// Attribute combination is stored as Record<string,string> (e.g. {"Size":"M","Color":"Red"}) —
// entered/displayed here as "Size:M, Color:Red" rather than building a full attribute-set-driven
// combination picker, which is a materially larger feature than this fix's scope.
function parseAttributes(input: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of input.split(',')) {
    const [key, value] = pair.split(':').map((s) => s.trim());
    if (key && value) result[key] = value;
  }
  return result;
}

function formatAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

export default function VariantManager({
  itemId,
  variants,
}: {
  itemId: number;
  variants: Variant[];
}) {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<VariantFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<VariantFormState>(EMPTY_FORM);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['items', String(itemId)] });
  }

  const addMutation = useMutation({
    mutationFn: (data: VariantFormState) =>
      itemApi.addVariants(itemId, [
        {
          sku: data.sku,
          attributeCombination: parseAttributes(data.attributes),
          ...(data.barcode ? { barcode: data.barcode } : {}),
          ...(data.mrp ? { mrp: parseFloat(data.mrp) } : {}),
          salePrice: parseFloat(data.salePrice || '0'),
          purchasePrice: parseFloat(data.purchasePrice || '0'),
          isActive: true,
        },
      ]),
    onSuccess: () => {
      toast.success('Variant added');
      setShowAddForm(false);
      setAddForm(EMPTY_FORM);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      variant,
      data,
    }: {
      variant: Variant;
      data: VariantFormState & { isActive: boolean };
    }) =>
      itemApi.updateVariant(itemId, variant.id, {
        sku: data.sku,
        attributeCombination: parseAttributes(data.attributes),
        ...(data.barcode ? { barcode: data.barcode } : {}),
        ...(data.mrp ? { mrp: parseFloat(data.mrp) } : {}),
        salePrice: parseFloat(data.salePrice || '0'),
        purchasePrice: parseFloat(data.purchasePrice || '0'),
        isActive: data.isActive,
        version: variant.version,
      }),
    onSuccess: () => {
      toast.success('Variant updated');
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(v: Variant) {
    setEditingId(v.id);
    setEditForm({
      sku: v.sku,
      attributes: formatAttributes(v.attributeCombination),
      barcode: v.barcode ?? '',
      mrp: v.mrp ?? '',
      salePrice: v.salePrice,
      purchasePrice: v.purchasePrice,
    });
  }

  function toggleActive(v: Variant) {
    updateMutation.mutate({
      variant: v,
      data: {
        sku: v.sku,
        attributes: formatAttributes(v.attributeCombination),
        barcode: v.barcode ?? '',
        mrp: v.mrp ?? '',
        salePrice: v.salePrice,
        purchasePrice: v.purchasePrice,
        isActive: !v.isActive,
      },
    });
  }

  return (
    <ERPFormSection title="Variants" columns={1}>
      <div className="sm:col-span-full">
        {variants.length === 0 && !showAddForm && (
          <p className="text-sm text-secondary mb-3">
            No variants yet — add one for each size/color/etc. combination this item comes in.
          </p>
        )}

        {variants.length > 0 && (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary border-b border-default">
                  <th className="pb-2">SKU</th>
                  <th className="pb-2">Attributes</th>
                  <th className="pb-2">Barcode</th>
                  <th className="pb-2 text-right">MRP</th>
                  <th className="pb-2 text-right">Sale Price</th>
                  <th className="pb-2 text-right">Purchase Price</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {variants.map((v) =>
                  editingId === v.id ? (
                    <tr key={v.id}>
                      <td className="py-2">
                        <Input
                          value={editForm.sku}
                          onChange={(e) => setEditForm((f) => ({ ...f, sku: e.target.value }))}
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          value={editForm.attributes}
                          placeholder="Size: M, Color: Red"
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, attributes: e.target.value }))
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          value={editForm.barcode}
                          onChange={(e) => setEditForm((f) => ({ ...f, barcode: e.target.value }))}
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.mrp}
                          onChange={(e) => setEditForm((f) => ({ ...f, mrp: e.target.value }))}
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.salePrice}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, salePrice: e.target.value }))
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={editForm.purchasePrice}
                          onChange={(e) =>
                            setEditForm((f) => ({ ...f, purchasePrice: e.target.value }))
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Badge variant={v.isActive ? 'success' : 'default'}>
                          {v.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          isLoading={updateMutation.isPending}
                          onClick={() =>
                            updateMutation.mutate({
                              variant: v,
                              data: { ...editForm, isActive: v.isActive },
                            })
                          }
                        >
                          Save
                        </Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={v.id}>
                      <td className="py-2 font-mono">{v.sku}</td>
                      <td className="py-2">{formatAttributes(v.attributeCombination) || '—'}</td>
                      <td className="py-2 font-mono">{v.barcode ?? '—'}</td>
                      <td className="py-2 text-right">{v.mrp ?? '—'}</td>
                      <td className="py-2 text-right">{v.salePrice}</td>
                      <td className="py-2 text-right">{v.purchasePrice}</td>
                      <td className="py-2">
                        <Badge variant={v.isActive ? 'success' : 'default'}>
                          {v.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(v)}>
                          Edit
                        </Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(v)}>
                          {v.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}

        {showAddForm ? (
          <div className="bg-surface-card border border-default rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="SKU"
                required
                value={addForm.sku}
                onChange={(e) => setAddForm((f) => ({ ...f, sku: e.target.value }))}
              />
              <Input
                label="Attributes"
                placeholder="Size: M, Color: Red"
                wrapperClassName="sm:col-span-2"
                value={addForm.attributes}
                onChange={(e) => setAddForm((f) => ({ ...f, attributes: e.target.value }))}
              />
              <Input
                label="Barcode"
                value={addForm.barcode}
                onChange={(e) => setAddForm((f) => ({ ...f, barcode: e.target.value }))}
              />
              <Input
                label="MRP (₹)"
                type="number"
                step="0.01"
                value={addForm.mrp}
                onChange={(e) => setAddForm((f) => ({ ...f, mrp: e.target.value }))}
              />
              <Input
                label="Sale Price (₹)"
                type="number"
                step="0.01"
                value={addForm.salePrice}
                onChange={(e) => setAddForm((f) => ({ ...f, salePrice: e.target.value }))}
              />
              <Input
                label="Purchase Price (₹)"
                type="number"
                step="0.01"
                value={addForm.purchasePrice}
                onChange={(e) => setAddForm((f) => ({ ...f, purchasePrice: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                isLoading={addMutation.isPending}
                disabled={!addForm.sku.trim() || !addForm.salePrice}
                onClick={() => addMutation.mutate(addForm)}
              >
                Save Variant
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowAddForm(false);
                  setAddForm(EMPTY_FORM);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setShowAddForm(true)}>
            + Add Variant
          </Button>
        )}
      </div>
    </ERPFormSection>
  );
}
