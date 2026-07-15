import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { warehouseApi, branchApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';

interface Warehouse {
  id: number;
  name: string;
  code: string;
  branchId: number;
  isDefault: boolean;
  isActive: boolean;
  version: number;
}
interface Branch {
  id: number;
  name: string;
}

export default function WarehousesPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManageWarehouse = hasPermission(PERMISSIONS.WAREHOUSE_MANAGE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses', debouncedSearch, page, pageSize],
    queryFn: () =>
      warehouseApi.list({ search: debouncedSearch || undefined, page: page - 1, size: pageSize }),
  });
  const { data: branchData } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
    enabled: hasPermission(PERMISSIONS.BRANCH_VIEW),
  });

  const warehouses: Warehouse[] = (data as { content?: Warehouse[] })?.content ?? [];
  const totalElements = (data as { totalElements?: number })?.totalElements ?? 0;
  const branches: Branch[] = (branchData as { content?: Branch[] })?.content ?? [];

  const qc = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: number) => warehouseApi.delete(id),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Warehouse>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'branchId',
      header: 'Branch',
      render: (r) => branches.find((b) => b.id === r.branchId)?.name ?? r.branchId,
    },
    {
      key: 'isDefault',
      header: 'Default',
      render: (r) => (r.isDefault ? <Badge variant="info">Default</Badge> : null),
    },
    {
      key: 'isActive',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={r.isActive ? 'success' : 'default'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const rowActions: ERPRowAction<Warehouse>[] = [
    ...(canManageWarehouse
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Warehouse) => navigate(`/settings/warehouses/${r.id}/edit`),
          },
        ]
      : []),
    ...(canManageWarehouse
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            type: 'delete' as const,
            onClick: async (r: Warehouse) => {
              const ok = await confirm({
                title: 'Delete Warehouse',
                message: `Are you sure you want to delete warehouse "${r.name}"? This cannot be undone.`,
                confirmLabel: 'Delete',
                variant: 'danger',
              });
              if (ok) deleteMutation.mutate(r.id);
            },
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Warehouses"
        subtitle="Manage warehouse/godown locations."
        actions={
          canManageWarehouse ? (
            <Button onClick={() => navigate('/settings/warehouses/new')}>+ New Warehouse</Button>
          ) : undefined
        }
      />
      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Search warehouses…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <ERPDataGrid
        columns={columns}
        data={warehouses}
        isLoading={isLoading}
        rowKey="id"
        pagination={{ page, pageSize, total: totalElements }}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        actions={rowActions}
      />
    </div>
  );
}
