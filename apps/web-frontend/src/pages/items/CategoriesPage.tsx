import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { categoryApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { useConfirm } from '../../context/ConfirmContext.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, {
  type ERPColumnDef,
  type ERPRowAction,
} from '../../components/erp/ERPDataGrid.js';
import ERPEmptyState from '../../components/erp/ERPEmptyState.js';
import Button from '../../components/ui/Button.js';

interface Category {
  id: number;
  name: string;
  code?: string;
  description?: string;
}

export default function CategoriesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateCategory = hasPermission(PERMISSIONS.CATEGORY_CREATE);
  const canUpdateCategory = hasPermission(PERMISSIONS.CATEGORY_UPDATE);
  const canDeleteCategory = hasPermission(PERMISSIONS.CATEGORY_DELETE);
  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoryApi.list(),
  });
  const cats: Category[] = (data as { content?: Category[] })?.content ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => categoryApi.delete(id),
    onSuccess: () => {
      toast.success('Deleted');
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Category>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'description', header: 'Description' },
  ];

  const rowActions: ERPRowAction<Category>[] = [
    ...(canUpdateCategory
      ? [
          {
            label: 'Edit',
            icon: Pencil,
            type: 'edit' as const,
            onClick: (r: Category) => navigate(`/inventory/categories/${r.id}/edit`),
          },
        ]
      : []),
    ...(canDeleteCategory
      ? [
          {
            label: 'Delete',
            icon: Trash2,
            type: 'delete' as const,
            onClick: async (r: Category) => {
              const ok = await confirm({
                title: 'Delete category?',
                message: `"${r.name}" will be permanently removed. Items already assigned to it keep their data but lose the category link.`,
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
        title="Item Categories"
        actions={
          canCreateCategory ? (
            <Button
              data-tour-id="inventory-categories-create-button"
              onClick={() => navigate('/inventory/categories/new')}
            >
              + New Category
            </Button>
          ) : undefined
        }
      />
      <ERPDataGrid
        columns={columns}
        data={cats}
        isLoading={isLoading}
        rowKey="id"
        emptyState={
          <ERPEmptyState
            type="no-data"
            title="No categories yet"
            description="Create categories to organize your item catalog and filter reports by product group."
            {...(canCreateCategory
              ? {
                  action: {
                    label: '+ New Category',
                    onClick: () => navigate('/inventory/categories/new'),
                  },
                }
              : {})}
          />
        }
        actions={rowActions}
      />
    </div>
  );
}
