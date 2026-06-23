import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { warehouseApi } from '../../api/endpoints';
import type { Warehouse, WarehouseRequest } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';

interface Props { mode: 'create' | 'edit' }
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const WarehouseFormPage: React.FC<Props> = ({ mode }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const state = useLocation().state as Warehouse | undefined;
  const [form, setForm] = useState<WarehouseRequest>({ name: state?.name || '', warehouseCode: state?.warehouseCode || '', description: state?.description || '', address: state?.address || '' });
  const mutation = useMutation({
    mutationFn: () => mode === 'edit' ? warehouseApi.update(id, form) : warehouseApi.create(form),
    onSuccess: async () => {
      toast.success(`Warehouse ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      await queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      navigate('/warehouses');
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} warehouse`),
  });
  const set = (field: keyof WarehouseRequest, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = () => { if (!form.name.trim()) return toast.error('Warehouse name is required.'); mutation.mutate(); };
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Settings &gt; Warehouses &gt; {mode === 'edit' ? 'Edit Warehouse' : 'Create Warehouse'}</div><div className="overflow-hidden rounded-lg bg-white shadow"><div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Warehouse Details</h1></div><div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2"><label className="text-sm text-gray-600">Name<input className={`${inputClass} mt-1`} value={form.name} onChange={(event) => set('name', event.target.value)} /></label><label className="text-sm text-gray-600">Warehouse Code<input className={`${inputClass} mt-1`} value={form.warehouseCode} onChange={(event) => set('warehouseCode', event.target.value)} /></label><label className="text-sm text-gray-600">Address<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={form.address} onChange={(event) => set('address', event.target.value)} /></label><label className="text-sm text-gray-600">Description<textarea className="mt-1 h-20 w-full rounded border border-gray-300 p-3" value={form.description} onChange={(event) => set('description', event.target.value)} /></label></div><div className="flex gap-3 border-t p-5"><Button onClick={submit} isLoading={mutation.isPending}>Submit</Button><Button variant="secondary" onClick={() => navigate('/warehouses')}>Close</Button></div></div></div>;
};
