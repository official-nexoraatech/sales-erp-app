import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { itemApi } from '../../api/endpoints';
import { Loader } from '../../components/ui/Loader';
import { getValidationErrors, hasValidationErrors } from '../../utils/apiValidation';
import { ItemForm } from './ItemForm';

export const ItemEditPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const item = useQuery({ queryKey: ['item', id], queryFn: () => itemApi.getById(id), enabled: id > 0 });
  const mutation = useMutation({
    mutationFn: (payload: any) => itemApi.update(id, payload),
    onSuccess: () => {
      toast.success('Item updated successfully');
      navigate('/items');
    },
    onError: (error: any) => {
      if (!hasValidationErrors(error)) toast.error(error?.message || 'Failed to update item');
    },
  });
  if (item.isLoading) return <Loader />;
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Items &gt; Item List &gt; Edit Item</div><ItemForm initial={item.data?.data} submitText="Update" loading={mutation.isPending} validationErrors={getValidationErrors(mutation.error)} onFieldChange={mutation.reset} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/items')} /></div>;
};
