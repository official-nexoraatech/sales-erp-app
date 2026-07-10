import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { priceListApi } from '../../api/endpoints.js';
import { useAuthStore } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';

interface PriceList { id: number; name: string; code: string; currency: string; isDefault: boolean; validFrom?: string; validTo?: string; }

export default function PriceListsPage() {
  const qc = useQueryClient();
  const canManagePriceList = useAuthStore((s) => s.hasPermission(PERMISSIONS.ITEM_EDIT));
  const [modal, setModal] = useState<{ open: boolean; pl?: PriceList }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['price-lists'], queryFn: () => priceListApi.list() });
  const priceLists: PriceList[] = (data as { content?: PriceList[] })?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<PriceList>>();

  function openNew() { reset({ currency: 'INR' }); setModal({ open: true }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => priceListApi.create(d),
    onSuccess: () => { toast.success('Price list created'); qc.invalidateQueries({ queryKey: ['price-lists'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns: ERPColumnDef<PriceList>[] = [
    { key: 'code', header: 'Code', mono: true, sortable: true },
    { key: 'name', header: 'Name', sortable: true },
    { key: 'currency', header: 'Currency' },
    { key: 'validFrom', header: 'Valid From' },
    { key: 'validTo', header: 'Valid To' },
    {
      key: 'isDefault', header: 'Default',
      render: (r) => r.isDefault ? <Badge variant="info">Default</Badge> : null,
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Price Lists" actions={canManagePriceList ? <Button onClick={openNew}>+ New Price List</Button> : undefined} />
      <ERPDataGrid columns={columns} data={priceLists} isLoading={isLoading} rowKey="id" />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title="New Price List" size="sm">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" required {...register('name', { required: 'Required' })} error={errors.name?.message} />
            <Input label="Code" required {...register('code', { required: 'Required' })} error={errors.code?.message} />
          </div>
          <Input label="Currency" {...register('currency')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Valid From" type="date" {...register('validFrom')} />
            <Input label="Valid To" type="date" {...register('validTo')} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isDefault" {...register('isDefault')} className="rounded border-default" />
            <label htmlFor="isDefault" className="text-sm text-primary">Set as Default</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setModal({ open: false })}>Cancel</Button>
            <Button type="submit" loading={isSubmitting || saveMutation.isPending}>Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
