import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { itemApi } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { getValidationErrors, hasValidationErrors } from '../../utils/apiValidation';
import { ItemForm } from './ItemForm';

export const ItemCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: itemApi.create,
    onSuccess: async () => {
      toast.success('Item created successfully');
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      navigate('/items');
    },
    onError: (error: any) => {
      if (!hasValidationErrors(error)) toast.error(error?.message || 'Failed to create item');
    },
  });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home &gt; Items &gt; Item List &gt; Create Item</div><ItemForm submitText="Submit" loading={mutation.isPending} validationErrors={getValidationErrors(mutation.error)} onFieldChange={mutation.reset} onSubmit={(payload) => mutation.mutate(payload)} onCancel={() => navigate('/items')} /></div>;
};
