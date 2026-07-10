import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Scissors } from 'lucide-react';
import { fabricRollApi, itemApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import { formatDate } from '../../lib/format.js';

interface FabricRoll {
  id: number;
  rollNumber: string;
  itemId: number;
  warehouseId: number;
  originalMeters: string;
  remainingMeters: string;
  status: string;
  receivedAt: string;
}

interface Item { id: number; name: string; isFabricItem?: boolean; }
interface Warehouse { id: number; name: string; }

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  AVAILABLE: 'success',
  PARTIALLY_CUT: 'warning',
  FULLY_CUT: 'default',
  DAMAGED: 'danger',
};

export default function FabricRollsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEditFabricRoll = hasPermission(PERMISSIONS.ITEM_EDIT);
  const [filterItemId, setFilterItemId] = useState('');
  const [showReceive, setShowReceive] = useState(false);
  const [showCut, setShowCut] = useState<{ rollId: number; rollNumber: string } | null>(null);

  // Receive form state
  const [rollNumber, setRollNumber] = useState('');
  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [meters, setMeters] = useState('');
  const [cutMeters, setCutMeters] = useState('');
  const [cutPurpose, setCutPurpose] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['fabric-rolls', filterItemId],
    queryFn: () => fabricRollApi.list(filterItemId ? Number(filterItemId) : undefined),
  });

  const { data: itemData } = useQuery({ queryKey: ['fabric-items'], queryFn: () => itemApi.list({ search: '' }) });
  const { data: whData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehouseApi.list(), enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW) });

  const rolls: FabricRoll[] = (data as FabricRoll[]) ?? [];
  const items: Item[] = (itemData as { content?: Item[] })?.content ?? [];
  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];

  const receiveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => fabricRollApi.receive(d),
    onSuccess: () => { toast.success('Roll received'); setShowReceive(false); qc.invalidateQueries({ queryKey: ['fabric-rolls'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cutMutation = useMutation({
    mutationFn: ({ rollId, d }: { rollId: number; d: Record<string, unknown> }) =>
      fabricRollApi.cut(rollId, d),
    onSuccess: () => { toast.success('Cut recorded'); setShowCut(null); qc.invalidateQueries({ queryKey: ['fabric-rolls'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<FabricRoll>[] = [
    { key: 'rollNumber', header: 'Roll #', mono: true, sortable: true },
    {
      key: 'itemId',
      header: 'Item',
      render: (r) => items.find((i) => i.id === r.itemId)?.name ?? String(r.itemId),
    },
    { key: 'originalMeters', header: 'Original (m)', align: 'right', render: (r) => parseFloat(r.originalMeters).toFixed(2) },
    {
      key: 'remainingMeters',
      header: 'Remaining (m)',
      align: 'right',
      sortable: true,
      render: (r) => {
        const rem = parseFloat(r.remainingMeters);
        const orig = parseFloat(r.originalMeters);
        const pct = orig > 0 ? (rem / orig) * 100 : 0;
        return <span className={pct < 20 ? 'text-danger font-semibold' : 'font-medium'}>{rem.toFixed(2)}</span>;
      },
    },
    { key: 'status', header: 'Status', sortable: true, render: (r) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge> },
    { key: 'receivedAt', header: 'Received', sortable: true, render: (r) => formatDate(r.receivedAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        if (!canEditFabricRoll || !(r.status === 'AVAILABLE' || r.status === 'PARTIALLY_CUT')) return null;
        const items: ERPMenuItem[] = [{ label: 'Cut', icon: Scissors, onClick: () => setShowCut({ rollId: r.id, rollNumber: r.rollNumber }) }];
        return <ERPDropdownMenu items={items} />;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Fabric Rolls" subtitle="FIFO fabric roll inventory — receive, cut, and track">
        {canEditFabricRoll && <Button onClick={() => setShowReceive(true)}>+ Receive Roll</Button>}
      </ERPPageHeader>

      <div className="mb-4 w-64">
        <Select
          label="Filter by Item"
          value={filterItemId}
          onChange={(e) => setFilterItemId(e.target.value)}
          options={[{ value: '', label: 'All Items' }, ...items.map((i) => ({ value: String(i.id), label: i.name }))]}
        />
      </div>

      <ERPDataGrid columns={columns} data={rolls} isLoading={isLoading} rowKey="id" />

      {/* Receive Roll Modal */}
      <Modal isOpen={showReceive} onClose={() => setShowReceive(false)} title="Receive Fabric Roll">
        <div className="space-y-4">
          <Input label="Roll Number" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} />
          <Select label="Item" value={itemId} onChange={(e) => setItemId(e.target.value)}
            options={[{ value: '', label: 'Select item...' }, ...items.map((i) => ({ value: String(i.id), label: i.name }))]} />
          <Select label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            options={[{ value: '', label: 'Select warehouse...' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]} />
          <Input label="Meters" type="number" value={meters} onChange={(e) => setMeters(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowReceive(false)}>Cancel</Button>
            <Button
              isLoading={receiveMutation.isPending}
              onClick={() => receiveMutation.mutate({
                rollNumber, itemId: Number(itemId), warehouseId: Number(warehouseId), meters: parseFloat(meters),
              })}
              disabled={!rollNumber || !itemId || !warehouseId || !meters}
            >
              Receive
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cut Roll Modal */}
      <Modal isOpen={!!showCut} onClose={() => setShowCut(null)} title={`Cut Roll ${showCut?.rollNumber}`}>
        <div className="space-y-4">
          <Input label="Meters to Cut" type="number" value={cutMeters} onChange={(e) => setCutMeters(e.target.value)} />
          <Input label="Purpose" value={cutPurpose} onChange={(e) => setCutPurpose(e.target.value)} placeholder="e.g. Sales order #123" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCut(null)}>Cancel</Button>
            <Button
              isLoading={cutMutation.isPending}
              onClick={() => showCut && cutMutation.mutate({
                rollId: showCut.rollId,
                d: { meters: parseFloat(cutMeters), purpose: cutPurpose || undefined },
              })}
              disabled={!cutMeters}
            >
              Record Cut
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
