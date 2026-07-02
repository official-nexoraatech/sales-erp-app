import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { categoryApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Category { id: number; name: string; code?: string; description?: string; }

export default function CategoriesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; cat?: Category }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => categoryApi.list() });
  const cats: Category[] = (data as { data?: { content?: Category[] } })?.data?.content ?? [];

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

  const columns = [
    { key: 'code', header: 'Code', className: 'font-mono text-xs' },
    { key: 'name', header: 'Name' },
    { key: 'description', header: 'Description' },
    {
      key: 'actions', header: '',
      render: (r: Category) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Item Categories" actions={<Button onClick={openNew}>+ New Category</Button>} />
      <DataTable columns={columns} data={cats} loading={isLoading} emptyMessage="No categories." />

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
