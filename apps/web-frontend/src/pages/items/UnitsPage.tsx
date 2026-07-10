import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Pencil } from 'lucide-react';
import { unitApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';

interface Unit { id: number; name: string; abbreviation: string; }

export default function UnitsPage() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateUnit = hasPermission(PERMISSIONS.UNIT_CREATE);
  const canUpdateUnit = hasPermission(PERMISSIONS.UNIT_UPDATE);
  const [modal, setModal] = useState<{ open: boolean; unit?: Unit }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['units'], queryFn: () => unitApi.list() });
  const units: Unit[] = (data as { content?: Unit[] })?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<Unit>>();

  function openNew() { reset({}); setModal({ open: true }); }
  function openEdit(u: Unit) { reset(u); setModal({ open: true, unit: u }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) =>
      modal.unit ? unitApi.update(modal.unit!.id, d) : unitApi.create(d),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['units'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<Unit>[] = [
    { key: 'abbreviation', header: 'Symbol', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = canUpdateUnit ? [{ label: 'Edit', icon: Pencil, onClick: () => openEdit(r) }] : [];
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Units of Measure" actions={canCreateUnit ? <Button onClick={openNew}>+ New Unit</Button> : undefined} />
      <ERPDataGrid columns={columns} data={units} isLoading={isLoading} rowKey="id" />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.unit ? 'Edit Unit' : 'New Unit'} size="sm">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" required placeholder="Metre" {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Symbol" required placeholder="m" {...register('abbreviation', { required: 'Required' })} error={errors.abbreviation?.message} />
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
