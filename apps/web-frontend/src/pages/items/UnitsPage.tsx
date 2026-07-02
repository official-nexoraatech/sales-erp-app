import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { unitApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Unit { id: number; name: string; symbol: string; decimalPlaces: number; }

export default function UnitsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; unit?: Unit }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['units'], queryFn: () => unitApi.list() });
  const units: Unit[] = (data as { data?: { content?: Unit[] } })?.data?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Unit>>();

  function openNew() { reset({ decimalPlaces: 2 }); setModal({ open: true }); }
  function openEdit(u: Unit) { reset(u); setModal({ open: true, unit: u }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      modal.unit ? unitApi.update(modal.unit!.id, d) : unitApi.create(d),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['units'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'symbol', header: 'Symbol', className: 'font-mono font-bold' },
    { key: 'name', header: 'Name' },
    { key: 'decimalPlaces', header: 'Decimals' },
    {
      key: 'actions', header: '',
      render: (r: Unit) => <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>,
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Units of Measure" actions={<Button onClick={openNew}>+ New Unit</Button>} />
      <DataTable columns={columns} data={units} loading={isLoading} emptyMessage="No units." />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.unit ? 'Edit Unit' : 'New Unit'} size="sm">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" required placeholder="Metre" {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Symbol" required placeholder="m" {...register('symbol', { required: 'Required' })} error={errors.symbol?.message} />
          </div>
          <Input label="Decimal Places" type="number" {...register('decimalPlaces')} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button type="submit" loading={isSubmitting || saveMutation.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
