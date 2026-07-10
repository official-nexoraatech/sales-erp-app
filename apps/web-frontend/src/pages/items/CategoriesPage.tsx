import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { categoryApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Category { id: number; name: string; code?: string; description?: string; }

export default function CategoriesPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateCategory = hasPermission(PERMISSIONS.CATEGORY_CREATE);
  const canUpdateCategory = hasPermission(PERMISSIONS.CATEGORY_UPDATE);
  const canDeleteCategory = hasPermission(PERMISSIONS.CATEGORY_DELETE);
  const [modal, setModal] = useState<{ open: boolean; cat?: Category }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => categoryApi.list() });
  const cats: Category[] = (data as { content?: Category[] })?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Category>>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(cat: Category) { reset(cat); setModal({ open: true, cat }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      modal.cat ? categoryApi.update(modal.cat!.id, d) : categoryApi.create(d),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['categories'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => categoryApi.delete(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['categories'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Category>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'description', header: 'Description' },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canUpdateCategory) items.push({ label: 'Edit', icon: Pencil, onClick: () => openEdit(r) });
        if (canDeleteCategory) items.push({ label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => deleteMutation.mutate(r.id) });
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Item Categories" actions={canCreateCategory ? <Button onClick={openNew}>+ New Category</Button> : undefined} />
      <ERPDataGrid columns={columns} data={cats} isLoading={isLoading} rowKey="id" />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.cat ? 'Edit Category' : 'New Category'} size="sm">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <Input label="Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
          <Input label="Code" {...register('code')} />
          <Input label="Description" {...register('description')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button type="submit" loading={isSubmitting || saveMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
