import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { brandApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Brand { id: number; name: string; code?: string; description?: string; }

export default function BrandsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; brand?: Brand }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['brands'], queryFn: () => brandApi.list() });
  const brands: Brand[] = (data as { data?: { content?: Brand[] } })?.data?.content ?? [];

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

  const columns = [
    { key: 'code', header: 'Code', className: 'font-mono text-xs' },
    { key: 'name', header: 'Name' },
    { key: 'description', header: 'Description' },
    {
      key: 'actions', header: '',
      render: (r: Brand) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Brands" actions={<Button onClick={openNew}>+ New Brand</Button>} />
      <DataTable columns={columns} data={brands} loading={isLoading} emptyMessage="No brands." />

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
