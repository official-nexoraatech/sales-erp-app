import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { itemApi } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Loader } from '../../components/ui/Loader';
import { getValidationErrors, hasValidationErrors } from '../../utils/apiValidation';
import { ItemForm } from './ItemForm';

export const ItemEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const item = useQuery({ queryKey: ['item', id], queryFn: () => itemApi.getById(id), enabled: id > 0 });
  const mutation = useMutation({
    mutationFn: async ({ payload, imageFile }: { payload: any; imageFile: File | null }) => {
      await itemApi.update(id, payload);
      if (imageFile) {
        await itemApi.uploadLogo(id, imageFile);
      }
    },
    onSuccess: async () => {
      toast.success('Item updated successfully');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['items'] }),
        queryClient.invalidateQueries({ queryKey: ['item', id] }),
      ]);
      navigate('/items');
    },
    onError: (error: any) => {
      if (!hasValidationErrors(error)) toast.error(error?.message || 'Failed to update item');
    },
  });
  if (item.isLoading) return <Loader />;
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Items &gt; Item List &gt; Edit Item</div><ItemForm initial={item.data?.data} submitText="Update" loading={mutation.isPending} validationErrors={getValidationErrors(mutation.error)} onFieldChange={mutation.reset} onSubmit={(payload, imageFile) => mutation.mutate({ payload, imageFile })} onCancel={() => navigate('/items')} /></div>;
};
