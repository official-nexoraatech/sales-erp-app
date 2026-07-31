import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ClipboardList } from 'lucide-react';
import { physicalVerifApi, warehouseApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Modal from '../../components/ui/Modal.js';
import Select from '../../components/ui/Select.js';
import { formatDate } from '../../lib/format.js';

interface Verification {
  id: number;
  verificationNumber: string;
  warehouseId: number;
  status: string;
  createdAt: string;
}

interface Warehouse {
  id: number;
  name: string;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'default',
  COUNTING: 'warning',
  REVIEW: 'warning',
  APPROVED: 'success',
  CANCELLED: 'danger',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  DRAFT: "Created, but the count snapshot hasn't been taken yet.",
  COUNTING: 'Snapshot taken — enter physical counts, then Approve to apply any variances.',
  REVIEW: 'Under review.',
  APPROVED:
    'Approved — any line with a variance automatically became a stock adjustment, already applied.',
  CANCELLED: 'Cancelled — no adjustments were created.',
};

export default function PhysicalVerificationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [showCreate, setShowCreate] = useState(false);
  const [newWarehouseId, setNewWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['physical-verifs', page, pageSize],
    queryFn: () => physicalVerifApi.list({ page, limit: pageSize }),
  });
  const { data: whData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => warehouseApi.list(),
    enabled: hasPermission(PERMISSIONS.WAREHOUSE_VIEW),
  });

  const verifs: Verification[] =
    ((data as Record<string, unknown>)?.content as Verification[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;
  const warehouses: Warehouse[] = (whData as { content?: Warehouse[] })?.content ?? [];

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => physicalVerifApi.create(data),
    onSuccess: (res) => {
      const id = (res as { id?: number })?.id;
      toast.success('Verification created');
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['physical-verifs'] });
      if (id) navigate(`/inventory/physical-verifications/${id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: ERPColumnDef<Verification>[] = [
    { key: 'verificationNumber', header: 'Number', mono: true, sortable: true },
    {
      key: 'warehouseId',
      header: 'Warehouse',
      render: (r) => warehouses.find((w) => w.id === r.warehouseId)?.name ?? String(r.warehouseId),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={STATUS_COLORS[r.status] ?? 'default'} title={STATUS_DESCRIPTIONS[r.status]}>
          {r.status}
        </Badge>
      ),
    },
    { key: 'createdAt', header: 'Date', sortable: true, render: (r) => formatDate(r.createdAt) },
  ];

  const rowActions: ERPRowAction<Verification>[] = [
    {
      label: 'Manage',
      icon: ClipboardList,
      onClick: (r: Verification) => navigate(`/inventory/physical-verifications/${r.id}`),
      hidden: (r: Verification) => !(r.status === 'DRAFT' || r.status === 'COUNTING'),
    },
    {
      label: 'View',
      icon: ClipboardList,
      type: 'view',
      onClick: (r: Verification) => navigate(`/inventory/physical-verifications/${r.id}`),
      hidden: (r: Verification) => r.status === 'DRAFT' || r.status === 'COUNTING',
    },
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Physical Verifications"
        subtitle="Count and verify physical stock"
      >
        <Button
          data-tour-id="inventory-physical-verifications-create-button"
          onClick={() => setShowCreate(true)}
        >
          + Start Verification
        </Button>
      </ERPPageHeader>

      <ERPDataGrid
        columns={columns}
        data={verifs}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No verifications yet"
            description="Start a physical verification to count actual stock against what the system expects."
            action={{ label: '+ Start Verification', onClick: () => setShowCreate(true) }}
          />
        }
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        actions={rowActions}
      />

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Physical Verification"
      >
        <div className="space-y-4">
          <Select
            label="Warehouse"
            value={newWarehouseId}
            onChange={(e) => setNewWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'Select warehouse...' },
              ...warehouses.map((w) => ({ value: String(w.id), label: w.name })),
            ]}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
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
