import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { brandApi, categoryApi } from '../../api/endpoints';
import type { SimpleMaster } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';

interface Props { type: 'category' | 'brand'; mode: 'create' | 'edit' }
const inputClass = 'h-10 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-gray-50';

export const MasterFormPage: React.FC<Props> = ({ type, mode }) => {
  const isCategory = type === 'category';
  const api = isCategory ? categoryApi : brandApi;
  const label = isCategory ? 'Category' : 'Brand';
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const location = useLocation();
  const state = location.state as SimpleMaster | undefined;
  const returnTo = new URLSearchParams(location.search).get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '';
  const [name, setName] = useState(mode === 'edit' ? state?.name || '' : '');
  const [description, setDescription] = useState(mode === 'edit' ? state?.description || '' : '');
  const [categoryId, setCategoryId] = useState(mode === 'edit' ? state?.categoryId || 0 : 0);
  const backPath = safeReturnTo || `/items/${isCategory ? 'categories' : 'brands'}`;
  const categories = useQuery({
    queryKey: ['category', 'brand-form'],
    queryFn: () => categoryApi.getAll({ page: 0, size: 100, search: '' }),
    enabled: !isCategory,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const payload = isCategory ? { name, description } : { name, description, categoryId };
      return mode === 'edit' ? api.update(id, payload) : api.create(payload);
    },
    onSuccess: async () => {
      toast.success(`${label} ${mode === 'edit' ? 'updated' : 'created'} successfully`);
      await queryClient.invalidateQueries({ queryKey: [type] });
      if (isCategory) {
        await queryClient.invalidateQueries({ queryKey: ['item-form-categories'] });
        await queryClient.invalidateQueries({ queryKey: ['item-list-categories'] });
        await queryClient.invalidateQueries({ queryKey: ['category', 'brand-form'] });
      } else {
        await queryClient.invalidateQueries({ queryKey: ['item-form-brands'] });
        await queryClient.invalidateQueries({ queryKey: ['item-list-brands'] });
      }
      navigate(backPath);
    },
    onError: (error: any) => toast.error(error?.message || `Failed to ${mode} ${label.toLowerCase()}`),
  });

  const submit = () => {
    if (!name.trim()) return toast.error(`${label} name is required.`);
    if (!isCategory && !categoryId) return toast.error('Category is required.');
    mutation.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Item &gt; {label} List &gt; {mode === 'edit' ? `Edit ${label}` : `Create ${label}`}</div>
      <div className={`overflow-hidden rounded-lg bg-white shadow ${isCategory ? '' : 'max-w-xl'}`}>
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold text-gray-900">{isCategory ? 'Item Category Details' : 'Brand Details'}</h1></div>
        <div className={`grid grid-cols-1 gap-4 p-5 ${isCategory ? 'md:grid-cols-2' : ''}`}>
          {!isCategory && (
            <label className="text-sm text-gray-600">Category
              <select className={`${inputClass} mt-1`} value={categoryId} disabled={categories.isLoading} onChange={(event) => setCategoryId(Number(event.target.value))}>
                <option value={0}>{categories.isLoading ? 'Loading categories...' : 'Select category'}</option>
                {(categories.data?.data?.content || []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm text-gray-600">Name<input className={`${inputClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="text-sm text-gray-600">Description<textarea className="mt-1 h-12 w-full rounded border border-gray-300 p-3" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div>
        <div className="flex gap-3 px-5 pb-5"><Button onClick={submit} isLoading={mutation.isPending}>Submit</Button><Button variant="secondary" onClick={() => navigate(backPath)}>Close</Button></div>
      </div>
    </div>
  );
};
