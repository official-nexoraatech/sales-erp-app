import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil, Trash2 } from 'lucide-react';
import { brandApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Brand { id: number; name: string; code?: string; description?: string; }

export default function BrandsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateBrand = hasPermission(PERMISSIONS.BRAND_CREATE);
  const canUpdateBrand = hasPermission(PERMISSIONS.BRAND_UPDATE);
  const [modal, setModal] = useState<{ open: boolean; brand?: Brand }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.list() });
  const brands: Brand[] = (data as { content?: Brand[] })?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Brand>>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(b: Brand) { reset(b); setModal({ open: true, brand: b }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      modal.brand ? brandApi.update(modal.brand!.id, d) : brandApi.create(d),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['brands'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => brandApi.delete(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['brands'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Brand>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'description', header: 'Description' },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canUpdateBrand) items.push({ label: 'Edit', icon: Pencil, onClick: () => openEdit(r) });
        if (canUpdateBrand) items.push({ label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => deleteMutation.mutate(r.id) });
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Brands" actions={canCreateBrand ? <Button onClick={openNew}>+ New Brand</Button> : undefined} />
      <ERPDataGrid columns={columns} data={brands} isLoading={isLoading} rowKey="id" />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.brand ? 'Edit Brand' : 'New Brand'} size="sm">
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
