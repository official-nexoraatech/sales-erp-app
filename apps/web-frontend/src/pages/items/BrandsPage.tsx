import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { brandApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';

interface Brand {
  id: number;
  name: string;
  code?: string;
  description?: string;
}

export default function BrandsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateBrand = hasPermission(PERMISSIONS.BRAND_CREATE);
  const canUpdateBrand = hasPermission(PERMISSIONS.BRAND_UPDATE);
  const { data, isLoading } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.list() });
  const brands: Brand[] = (data as { content?: Brand[] })?.content ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => brandApi.delete(id),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Brand>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'description', header: 'Description' },
  ];

  const rowActions: ERPRowAction<Brand>[] = [
    ...(canUpdateBrand
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Brand) => navigate(`/inventory/brands/${r.id}/edit`),
          },
        ]
      : []),
    ...(canUpdateBrand
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            type: 'delete' as const,
            onClick: (r: Brand) => deleteMutation.mutate(r.id),
          },
        ]
      : []),
  ];

  return (
    <div>
      <ERPPageHeader
        variant="list"
        title="Brands"
        actions={
          canCreateBrand ? (
            <Button onClick={() => navigate('/inventory/brands/new')}>+ New Brand</Button>
          ) : undefined
        }
      />
      <ERPDataGrid
        columns={columns}
        data={brands}
        isLoading={isLoading}
        rowKey="id"
        actions={rowActions}
      />
    </div>
  );
}
