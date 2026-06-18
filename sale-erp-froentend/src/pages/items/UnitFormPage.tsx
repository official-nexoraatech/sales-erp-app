import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { unitApi } from '../../api/endpoints';
import type { Unit, UnitRequest } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';

interface Props { mode: 'create' | 'edit' }

const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const UnitFormPage: React.FC<Props> = ({ mode }) => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const state = useLocation().state as Unit | undefined;
  const [form, setForm] = useState<UnitRequest>({
    name: state?.name || '',
    shortName: state?.shortName || '',
  });

  const mutation = useMutation({
    mutationFn: () => mode === 'edit' ? unitApi.update(id, form) : unitApi.create(form),
    onSuccess: async () => {
      toast.success(`Unit ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      await queryClient.invalidateQueries({ queryKey: ['units'] });
      navigate('/items/units');
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} unit`),
  });

  const set = (field: keyof UnitRequest, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = () => {
    if (!form.name.trim()) return alert('Unit name is required.');
    if (!form.shortName.trim()) return alert('Short name is required.');
    mutation.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Item &gt; Unit List &gt; {mode === 'edit' ? 'Edit Unit' : 'Create Unit'}</div>
      <div className="max-w-xl overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">Unit Details</h1></div>
        <div className="grid grid-cols-1 gap-4 p-5">
          <label className="text-sm text-gray-600">Name<input className={`${inputClass} mt-1`} value={form.name} onChange={(event) => set('name', event.target.value)} /></label>
          <label className="text-sm text-gray-600">Short Name<input className={`${inputClass} mt-1`} value={form.shortName} onChange={(event) => set('shortName', event.target.value)} /></label>
        </div>
        <div className="flex gap-3 px-5 pb-5"><Button onClick={submit} isLoading={mutation.isPending}>Submit</Button><Button variant="secondary" onClick={() => navigate('/items/units')}>Close</Button></div>
      </div>
    </div>
  );
};
