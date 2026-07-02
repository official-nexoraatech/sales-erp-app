import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { physicalVerifApi, warehouseApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Select from '../../components/ui/Select.js';
import { formatDate, formatDatetime, formatCurrency } from '../../lib/format.js';

interface Verification {
  id: number;
  verificationNumber: string;
  warehouseId: number;
  status: string;
  createdAt: string;
}

interface Warehouse { id: number; name: string; }

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  COUNTING: 'warning',
  REVIEW: 'warning',
  APPROVED: 'success',
  CANCELLED: 'danger',
};

export default function PhysicalVerificationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newWarehouseId, setNewWarehouseId] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['physical-verifs'], queryFn: () => physicalVerifApi.list() });
  const { data: whData } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehouseApi.list() });

  const verifs: Verification[] = (data as { data?: Verification[] })?.data ?? [];
  const warehouses: Warehouse[] = (whData as { data?: Warehouse[] })?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => physicalVerifApi.create(data),
    onSuccess: (res) => {
      const id = (res as { data?: { id?: number } })?.data?.id;
      toast.success('Verification created');
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['physical-verifs'] });
      if (id) navigate(`/inventory/physical-verifications/${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns = [
    { key: 'verificationNumber', header: 'Number', className: 'font-mono text-sm' },
    {
      key: 'warehouseId',
      header: 'Warehouse',
      render: (r: Verification) => warehouses.find((w) => w.id === r.warehouseId)?.name ?? String(r.warehouseId),
    },
    { key: 'status', header: 'Status', render: (r: Verification) => <Badge variant={STATUS_COLORS[r.status] ?? 'default'}>{r.status}</Badge> },
    { key: 'createdAt', header: 'Date', render: (r: Verification) => formatDate(r.createdAt) },
    {
      key: 'actions',
      header: '',
      render: (r: Verification) => (
        <Button size="sm" variant="ghost" onClick={() => navigate(`/inventory/physical-verifications/${r.id}`)}>
          {r.status === 'DRAFT' || r.status === 'COUNTING' ? 'Manage' : 'View'}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Physical Verifications" subtitle="Count and verify physical stock">
        <Button onClick={() => setShowCreate(true)}>+ Start Verification</Button>
      </ERPPageHeader>

      <DataTable columns={columns} data={verifs} isLoading={isLoading} emptyMessage="No verifications found" />

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Physical Verification">
        <div className="space-y-4">
          <Select
            label="Warehouse"
            value={newWarehouseId}
            onChange={(e) => setNewWarehouseId(e.target.value)}
            options={[{ value: '', label: 'Select warehouse...' }, ...warehouses.map((w) => ({ value: String(w.id), label: w.name }))]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ warehouseId: Number(newWarehouseId) })}
              isLoading={createMutation.isPending}
              disabled={!newWarehouseId}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
