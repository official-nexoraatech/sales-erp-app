import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { supplierApi } from '../../api/endpoints.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';
import Input from '../../components/ui/Input.js';

interface Supplier {
  id: number;
  supplierCode: string;
  displayName: string;
  phone?: string;
  gstin?: string;
  status: string;
}

export default function SuppliersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateSupplier = hasPermission(PERMISSIONS.SUPPLIER_CREATE);
  const canEditSupplier = hasPermission(PERMISSIONS.SUPPLIER_EDIT);
  const canDeleteSupplier = hasPermission(PERMISSIONS.SUPPLIER_DELETE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['suppliers', debouncedSearch, page, pageSize],
    queryFn: () =>
      supplierApi.list({ search: debouncedSearch || undefined, page: page - 1, size: pageSize }),
  });
  const suppliers: Supplier[] = ((data as Record<string, unknown>)?.content as Supplier[]) ?? [];
  const totalElements = ((data as Record<string, unknown>)?.totalElements as number) ?? 0;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => supplierApi.delete(id),
    onSuccess: () => {
      toast.success('Supplier deleted');
      qc.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Supplier>[] = [
    { key: 'supplierCode', header: 'Code', mono: true, sortable: true },
    {
      key: 'displayName',
      header: 'Name',
      sortable: true,
      render: (r) => (
        <div>
          <button
            onClick={() => navigate(`/suppliers/${r.id}/edit`)}
            className="font-medium text-link hover:underline text-left"
          >
            {r.displayName}
          </button>
          {r.phone && <p className="text-xs text-secondary">{r.phone}</p>}
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', mono: true },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (r) => (
        <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>{r.status}</Badge>
      ),
    },
  ];

  const rowActions: ERPRowAction<Supplier>[] = [
    ...(canEditSupplier
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Supplier) => navigate(`/suppliers/${r.id}/edit`),
          },
        ]
      : []),
    ...(canDeleteSupplier
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            type: 'delete' as const,
            onClick: (r: Supplier) => deleteMutation.mutate(r.id),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Suppliers"
        subtitle="Manage your supplier / vendor database."
        actions={
          canCreateSupplier ? (
            <Button onClick={() => navigate('/suppliers/new')}>+ New Supplier</Button>
          ) : undefined
        }
      />
      <div className="mb-4">
        <Input
          placeholder="Search suppliers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>
      {isError ? (
        <ERPEmptyState type="error" />
      ) : (
        <ERPDataGrid
          columns={columns}
          data={suppliers}
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
      )}
    </div>
  );
}
