import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productionApi, supplierApi, itemApi, warehouseApi, branchApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import { ERPFormSkeleton } from '../../components/erp/ERPSkeleton.js';
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
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [supplierId, setSupplierId] = useState('');
  const [branchId, setBranchId] = useState('');
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

  const { data: suppliersData, isLoading: suppliersLoading } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => supplierApi.list(),
    enabled: hasPermission(PERMISSIONS.SUPPLIER_VIEW),
  });
  const suppliers = ((suppliersData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });
  const branches = ((branchesData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const userBranchIds = useAuthStore((s) => s.user?.branchIds) ?? [];
  useEffect(() => {
    if (!branchId && userBranchIds.length === 1) setBranchId(String(userBranchIds[0]));
  }, [branchId, userBranchIds]);

  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ['items-list'],
    queryFn: () => itemApi.list(),
    enabled: hasPermission(PERMISSIONS.ITEM_VIEW),
  });
  const items = ((itemsData as Record<string, unknown>)?.content as { id: number; name: string }[]) ?? [];

  const { data: warehousesData, isLoading: warehousesLoading } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
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
      branchId: parseInt(branchId, 10),
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

  if (suppliersLoading || itemsLoading || warehousesLoading) {
    return (
      <div className="max-w-3xl">
        <ERPPageHeader variant="detail" title="New Job Work Order" subtitle="Create an outsourced stitching or processing order." backTo="/production/job-work" />
        <ERPFormSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <ERPPageHeader variant="detail" title="New Job Work Order" subtitle="Create an outsourced stitching or processing order." backTo="/production/job-work" />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-surface-card rounded-xl border border-default p-6 space-y-4">
          <h3 className="font-semibold text-primary">Order Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <Select label="Supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label="Branch" required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label="Output Warehouse" required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select warehouse</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label="Output Item" required value={outputItemId} onChange={(e) => setOutputItemId(e.target.value)}>
              <option value="">Select item</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
            <Input label="Ordered Qty" required type="number" min="0.01" step="0.01" value={orderedQty} onChange={(e) => setOrderedQty(e.target.value)} />
            <Input label="Job Work Rate (per unit)" required type="number" min="0" step="0.01" value={jobWorkRate} onChange={(e) => setJobWorkRate(e.target.value)} />
            <Input label="Order Date" required type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            <Input label="Expected Completion" required type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
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
