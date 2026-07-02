import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { priceListApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Modal from '../../components/ui/Modal.js';
import Input from '../../components/ui/Input.js';
import Badge from '../../components/ui/Badge.js';

interface PriceList { id: number; name: string; code: string; currency: string; isDefault: boolean; validFrom?: string; validTo?: string; }

export default function PriceListsPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<{ open: boolean; pl?: PriceList }>({ open: false });
  const { data, isLoading } = useQuery({ queryKey: ['price-lists'], queryFn: () => priceListApi.list() });
  const priceLists: PriceList[] = (data as { data?: { content?: PriceList[] } })?.data?.content ?? [];

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Partial<PriceList>>();

  function openNew() { reset({ currency: 'INR' }); setModal({ open: true }); }

  const saveMutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => priceListApi.create(d),
    onSuccess: () => { toast.success('Price list created'); qc.invalidateQueries({ queryKey: ['price-lists'] }); setModal({ open: false }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    { key: 'code', header: 'Code', className: 'font-mono text-xs' },
    { key: 'name', header: 'Name' },
    { key: 'currency', header: 'Currency' },
    { key: 'validFrom', header: 'Valid From' },
    { key: 'validTo', header: 'Valid To' },
    {
      key: 'isDefault', header: 'Default',
      render: (r: PriceList) => r.isDefault ? <Badge label="Default" color="indigo" /> : null,
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list" title="Price Lists" actions={<Button onClick={openNew}>+ New Price List</Button>} />
      <DataTable columns={columns} data={priceLists} loading={isLoading} emptyMessage="No price lists." />

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title="New Price List" size="sm">
        <form onSubmit={handleSubmit((d) => saveMutation.mutate(d as Record<string, unknown>))} className="space-y-4">
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
            <input type="checkbox" id="isDefault" {...register('isDefault')} className="rounded border-gray-300" />
            <label htmlFor="isDefault" className="text-sm text-gray-700 dark:text-gray-300">Set as Default</label>
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
