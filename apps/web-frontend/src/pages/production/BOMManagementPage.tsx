import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi, itemApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPTableSkeleton } from '../../components/erp/ERPSkeleton.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate } from '../../lib/format.js';

interface Bom {
  id: number;
  name: string;
  outputQty: string;
  isActive: boolean;
  version: number;
  createdAt: string;
}

interface LineInput {
  componentItemId: string;
  quantityPerOutput: string;
  scrapPercent: string;
}

export default function BOMManagementPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [itemId, setItemId] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: itemsData } = useQuery({
    queryKey: ['items-list'],
    queryFn: () => itemApi.list(),
    enabled: hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const items =
    ((itemsData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['boms-for-item', itemId],
    queryFn: () => productionApi.listBomsForItem(parseInt(itemId, 10)),
    enabled: !!itemId,
  });
  const boms: Bom[] = (data as Bom[]) ?? [];

  // Create form
  const [name, setName] = useState('');
  const [outputQty, setOutputQty] = useState('1');
  const [lines, setLines] = useState<LineInput[]>([
    { componentItemId: '', quantityPerOutput: '', scrapPercent: '0' },
  ]);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => productionApi.createBom(payload),
    onSuccess: () => {
      toast.success('BOM saved');
      setShowCreateForm(false);
      setName('');
      setOutputQty('1');
      setLines([{ componentItemId: '', quantityPerOutput: '', scrapPercent: '0' }]);
      qc.invalidateQueries({ queryKey: ['boms-for-item', itemId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addLine() {
    setLines((prev) => [
      ...prev,
      { componentItemId: '', quantityPerOutput: '', scrapPercent: '0' },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof LineInput, value: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      name,
      finishedItemId: parseInt(itemId, 10),
      outputQty: parseFloat(outputQty),
      lines: lines
        .filter((l) => l.componentItemId && l.quantityPerOutput)
        .map((l) => ({
          componentItemId: parseInt(l.componentItemId, 10),
          quantityPerOutput: parseFloat(l.quantityPerOutput),
          scrapPercent: parseFloat(l.scrapPercent) || 0,
        })),
    });
  }

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Bill of Materials"
        subtitle="Define the components and quantities required to produce a finished item."
      />

      <div className="mb-4 max-w-xs">
        <Select label="Finished Item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select an item</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </div>

      {itemId && hasPermission(PERMISSIONS.BOM_CREATE) && (
        <div className="mb-4">
          <Button onClick={() => setShowCreateForm(!showCreateForm)}>
            {showCreateForm ? 'Cancel' : '+ New BOM Version'}
          </Button>
        </div>
      )}

      {showCreateForm && (
        <div className="bg-surface-card rounded-xl border border-default p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-primary">New BOM Version</h3>
          <p className="text-xs text-secondary">
            Saving this will deactivate the current active BOM for this item, if any.
          </p>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
              <Input
                label="Output Qty (units this recipe yields)"
                required
                type="number"
                min="0.001"
                step="0.001"
                value={outputQty}
                onChange={(e) => setOutputQty(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-primary">Components</h4>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  + Add Component
                </Button>
              </div>
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-5 gap-3 items-end">
                  <div className="col-span-2">
                    <Select
                      label="Component Item"
                      value={l.componentItemId}
                      onChange={(e) => updateLine(idx, 'componentItemId', e.target.value)}
                    >
                      <option value="">Select item</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Input
                    label="Qty per Output Unit"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={l.quantityPerOutput}
                    onChange={(e) => updateLine(idx, 'quantityPerOutput', e.target.value)}
                  />
                  <Input
                    label="Scrap %"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={l.scrapPercent}
                    onChange={(e) => updateLine(idx, 'scrapPercent', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="danger-outline"
                    size="sm"
                    onClick={() => removeLine(idx)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Save BOM'}
            </Button>
          </form>
        </div>
      )}

      {!itemId ? (
        <ERPEmptyState
          type="no-data"
          title="Select a finished item"
          description="Choose a finished item above to view or create its bill of materials."
        />
      ) : isLoading ? (
        <ERPTableSkeleton rows={4} cols={5} />
      ) : boms.length === 0 ? (
        <ERPEmptyState
          type="no-data"
          title="No BOM defined yet"
          description="This item has no bill of materials yet."
          {...(hasPermission(PERMISSIONS.BOM_CREATE)
            ? { action: { label: '+ New BOM Version', onClick: () => setShowCreateForm(true) } }
            : {})}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-surface-card rounded-xl border border-default overflow-hidden">
            <thead className="bg-surface-subtle">
              <tr className="text-left text-xs uppercase text-secondary">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Output Qty</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {boms.map((b) => (
                <tr key={b.id} className="hover:bg-surface-subtle">
                  <td className="px-4 py-3">{b.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{b.outputQty}</td>
                  <td className="px-4 py-3">{b.version}</td>
                  <td className="px-4 py-3">
                    <Badge variant={b.isActive ? 'success' : 'default'}>
                      {b.isActive ? 'Active' : 'Superseded'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">{formatDate(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
