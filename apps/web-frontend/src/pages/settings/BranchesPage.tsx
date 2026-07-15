import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { branchApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';

interface Address {
  line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

interface Branch {
  id: number;
  name: string;
  code: string;
  address: Address | null;
  isHeadOffice: boolean;
  isActive: boolean;
  gstin?: string | null;
  phone?: string | null;
  version: number;
}

export default function BranchesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canManageBranch = useAuthStore((s) => s.hasPermission(PERMISSIONS.BRANCH_MANAGE));
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['branches', debouncedSearch, page, pageSize],
    queryFn: () =>
      branchApi.list({ search: debouncedSearch || undefined, page: page - 1, size: pageSize }),
  });
  const branches: Branch[] = (data as { content?: Branch[] })?.content ?? [];
  const totalElements = (data as { totalElements?: number })?.totalElements ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => branchApi.delete(id),
    onSuccess: () => {
      toast.success('Branch deleted');
      qc.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Branch>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'city', header: 'City', render: (r) => r.address?.city ?? '–' },
    { key: 'state', header: 'State', render: (r) => r.address?.state ?? '–' },
    {
      key: 'isHeadOffice',
      header: 'HO',
      render: (r) => (r.isHeadOffice ? <Badge variant="info">HQ</Badge> : null),
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

  const rowActions: ERPRowAction<Branch>[] = [
    ...(canManageBranch
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Branch) => navigate(`/settings/branches/${r.id}/edit`),
          },
        ]
      : []),
    ...(canManageBranch
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            type: 'delete' as const,
            onClick: async (r: Branch) => {
              const ok = await confirm({
                title: 'Delete Branch',
                message: `Are you sure you want to delete branch "${r.name}"? This cannot be undone.`,
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
        title="Branches"
        subtitle="Manage your store branches and locations."
        actions={
          canManageBranch ? (
            <Button onClick={() => navigate('/settings/branches/new')}>+ New Branch</Button>
          ) : undefined
        }
      />

      <div className="flex gap-3 mb-4">
        <Input
          placeholder="Search branches…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <ERPDataGrid
        columns={columns}
        data={branches}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No branches found"
            description="Create your first branch."
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
    </div>
  );
}
