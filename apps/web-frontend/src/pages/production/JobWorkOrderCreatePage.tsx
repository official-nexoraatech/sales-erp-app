import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi, supplierApi, itemApi, warehouseApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

interface MaterialLine {
  itemId: string;
  requiredQty: string;
  unitCost: string;
  warehouseId: string;
}

export default function JobWorkOrderCreatePage() {
  const navigate = useNavigate();

  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [outputItemId, setOutputItemId] = useState('');
  const [orderedQty, setOrderedQty] = useState('');
  const [jobWorkRate, setJobWorkRate] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [materials, setMaterials] = useState<MaterialLine[]>([
    { itemId: '', requiredQty: '', unitCost: '', warehouseId: '' },
  ]);

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => supplierApi.list(),
  });
  const suppliers = ((suppliersData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data: itemsData } = useQuery({
    queryKey: ['items-list'],
    queryFn: () => itemApi.list(),
  });
  const items = ((itemsData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => warehouseApi.list(),
  });
  const warehouses =
    ((warehousesData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => productionApi.createJobWorkOrder(payload),
    onSuccess: () => {
      toast.success('Job work order created');
      navigate('/production/job-work');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addMaterial() {
    setMaterials((prev) => [...prev, { itemId: '', requiredQty: '', unitCost: '', warehouseId: '' }]);
  }

  function removeMaterial(idx: number) {
    setMaterials((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateMaterial(idx: number, field: keyof MaterialLine, value: string) {
    setMaterials((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      supplierId: parseInt(supplierId, 10),
      warehouseId: parseInt(warehouseId, 10),
      outputItemId: parseInt(outputItemId, 10),
      orderedQty: parseFloat(orderedQty),
      jobWorkRate: parseFloat(jobWorkRate),
      orderDate: new Date(orderDate).toISOString(),
      expectedDate: new Date(expectedDate).toISOString(),
      notes: notes || undefined,
      materials: materials
        .filter((m) => m.itemId && m.requiredQty)
        .map((m) => ({
          itemId: parseInt(m.itemId, 10),
          requiredQty: parseFloat(m.requiredQty),
          unitCost: parseFloat(m.unitCost) || 0,
          warehouseId: m.warehouseId ? parseInt(m.warehouseId, 10) : parseInt(warehouseId, 10),
        })),
    });
  }

  return (
    <div className="max-w-3xl">
      <ERPPageHeader variant="detail" title="New Job Work Order" subtitle="Create an outsourced stitching or processing order." backTo="/production/job-work" />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-surface-card rounded-xl border border-default p-6 space-y-4">
          <h3 className="font-semibold text-primary">Order Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Supplier *</label>
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Select supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Output Warehouse *</label>
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                <option value="">Select warehouse</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Output Item *</label>
              <Select value={outputItemId} onChange={(e) => setOutputItemId(e.target.value)} required>
                <option value="">Select item</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Ordered Qty *</label>
              <Input type="number" min="0.01" step="0.01" value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Job Work Rate (per unit) *</label>
              <Input type="number" min="0" step="0.01" value={jobWorkRate} onChange={(e) => setJobWorkRate(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Order Date *</label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Expected Completion *</label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Notes</label>
            <textarea
              className="w-full border border-default rounded-lg px-3 py-2 text-sm bg-surface focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="bg-surface-card rounded-xl border border-default p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-primary">Materials Required</h3>
            <Button type="button" variant="outline" size="sm" onClick={addMaterial}>+ Add Material</Button>
          </div>
          {materials.map((m, idx) => (
            <div key={idx} className="grid grid-cols-5 gap-3 items-end">
              <div className="col-span-2">
                <label className="block text-xs text-secondary mb-1">Item</label>
                <Select value={m.itemId} onChange={(e) => updateMaterial(idx, 'itemId', e.target.value)}>
                  <option value="">Select item</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1">Required Qty</label>
                <Input type="number" min="0.01" step="0.01" value={m.requiredQty} onChange={(e) => updateMaterial(idx, 'requiredQty', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-secondary mb-1">Unit Cost</label>
                <Input type="number" min="0" step="0.01" value={m.unitCost} onChange={(e) => updateMaterial(idx, 'unitCost', e.target.value)} />
              </div>
              <div>
                <Button type="button" variant="danger-outline" size="sm" onClick={() => removeMaterial(idx)}>Remove</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create Order'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/production/job-work')}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
