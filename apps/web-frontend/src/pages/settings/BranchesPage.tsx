import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { branchApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';

interface Branch {
  id: number;
  name: string;
  code: string;
  city: string;
  state: string;
  isHeadOffice: boolean;
  isActive: boolean;
  gstin?: string;
}

export default function BranchesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; branch?: Branch }>({ open: false });
  const { data, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => branchApi.list(),
  });
  const branches: Branch[] = (data as { data?: { content?: Branch[] } })?.data?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Branch> & { pinCode?: string; phone?: string; isHeadOffice?: boolean }>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(branch: Branch) { reset(branch); setModal({ open: true, branch }); }

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      modal.branch ? branchApi.update(modal.branch!.id, payload) : branchApi.create(payload),
    onSuccess: () => {
      toast.success(modal.branch ? 'Branch updated' : 'Branch created');
      qc.invalidateQueries({ queryKey: ['branches'] });
      setModal({ open: false });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => branchApi.delete(id),
    onSuccess: () => { toast.success('Branch deleted'); qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'code', header: 'Code', className: 'font-mono' },
    { key: 'name', header: 'Name' },
    { key: 'city', header: 'City' },
    { key: 'state', header: 'State' },
    {
      key: 'isHeadOffice', header: 'HO',
      render: (r: Branch) => r.isHeadOffice ? <Badge label="HQ" color="indigo" /> : null,
    },
    {
      key: 'isActive', header: 'Status',
      render: (r: Branch) => <Badge label={r.isActive ? 'Active' : 'Inactive'} color={r.isActive ? 'green' : 'gray'} />,
    },
    {
      key: 'actions', header: '',
      render: (r: Branch) => (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Delete</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Branches"
        subtitle="Manage your store branches and locations."
        actions={<Button onClick={openNew}>+ New Branch</Button>}
      />

      <DataTable columns={columns} data={branches} loading={isLoading} emptyMessage="No branches found. Create your first branch." />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.branch ? 'Edit Branch' : 'New Branch'}>
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Branch Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Code" required placeholder="BR001" {...register('code', { required: 'Required' })} error={errors.code?.message} />
          </div>
          <Input label="GSTIN" placeholder="27AAPFU0939F1ZV" {...register('gstin')} />
          <div className="grid grid-cols-3 gap-4">
            <Input label="City" {...register('city')} />
            <Input label="State" {...register('state')} />
            <Input label="PIN Code" {...register('pinCode')} />
          </div>
          <Input label="Phone" {...register('phone')} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isHeadOffice" {...register('isHeadOffice')} className="rounded border-gray-300" />
            <label htmlFor="isHeadOffice" className="text-sm text-gray-700 dark:text-gray-300">Head Office</label>
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
