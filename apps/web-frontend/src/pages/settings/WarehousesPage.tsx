import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { warehouseApi, branchApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';
import Badge from '../../components/ui/Badge.js';

interface Warehouse { id: number; name: string; code: string; branchId: number; isDefault: boolean; isActive: boolean; }
interface Branch { id: number; name: string; }

export default function WarehousesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; wh?: Warehouse }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['warehouses'], queryFn: () => warehouseApi.list() });
  const { data: branchData } = useQuery({ queryKey: ['branches'], queryFn: () => branchApi.list() });

  const warehouses: Warehouse[] = (data as { data?: { content?: Warehouse[] } })?.data?.content ?? [];
  const branches: Branch[] = (branchData as { data?: { content?: Branch[] } })?.data?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Warehouse>>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(wh: Warehouse) { reset(wh); setModal({ open: true, wh }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      modal.wh ? warehouseApi.update(modal.wh!.id, d) : warehouseApi.create(d),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['warehouses'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => warehouseApi.delete(id),
    onSuccess: () => { toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['warehouses'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'code', header: 'Code', className: 'font-mono' },
    { key: 'name', header: 'Name' },
    {
      key: 'branchId', header: 'Branch',
      render: (r: Warehouse) => branches.find((b) => b.id === r.branchId)?.name ?? r.branchId,
    },
    {
      key: 'isDefault', header: 'Default',
      render: (r: Warehouse) => r.isDefault ? <Badge label="Default" color="indigo" /> : null,
    },
    {
      key: 'isActive', header: 'Status',
      render: (r: Warehouse) => <Badge label={r.isActive ? 'Active' : 'Inactive'} color={r.isActive ? 'green' : 'gray'} />,
    },
    {
      key: 'actions', header: '',
      render: (r: Warehouse) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Warehouses" subtitle="Manage warehouse/godown locations." actions={<Button onClick={openNew}>+ New Warehouse</Button>} />
      <DataTable columns={columns} data={warehouses} loading={isLoading} emptyMessage="No warehouses found." />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.wh ? 'Edit Warehouse' : 'New Warehouse'}>
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Code" required {...register('code', { required: 'Required' })} error={errors.code?.message} />
          </div>
          <Select label="Branch" required {...register('branchId', { required: 'Required' })} error={errors.branchId?.message}>
            <option value="">Select branch…</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isDefault" {...register('isDefault')} className="rounded border-gray-300" />
            <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">Set as Default</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button type="submit" loading={isSubmitting || saveMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
