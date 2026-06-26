import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supplierApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { getDefaultAuthorizedPath } from '../../../auth/featurePermissions';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { useAuth } from '../../../hooks/useAuth';
import { SupplierForm } from './SupplierForm';
import { supplierSchema, toSupplierRequest } from './supplier.schema';
import type { SupplierFormData, SupplierFormInput } from './supplier.schema';

export const SupplierCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const defaultPath = getDefaultAuthorizedPath(user?.permissions, user?.role);
  const { register, setValue, handleSubmit, formState: { errors } } = useForm<SupplierFormInput, unknown, SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { status: 'ACTIVE', isDefaultSupplier: false },
  });
  const mutation = useMutation({
    mutationFn: (data: SupplierFormData) => supplierApi.create(toSupplierRequest(data)),
    onSuccess: () => {
      toast.success('Supplier created successfully');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/contacts/suppliers');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create supplier'),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <button onClick={() => navigate(defaultPath)} className="text-blue-600 hover:underline">Home</button>
        <span>›</span><span>Contacts</span><span>›</span>
        <button onClick={() => navigate('/contacts/suppliers')} className="hover:underline">Supplier List</button>
        <span>›</span><span className="text-gray-700">Create Supplier</span>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="border-b border-gray-200 px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Supplier Details</h1>
        </div>
        <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
          <div className="px-5 pt-1"><SupplierForm register={register} setValue={setValue} errors={errors} /></div>
          <div className="flex justify-end gap-3 border-t px-5 py-4">
            <Button type="button" variant="secondary" onClick={() => navigate('/contacts/suppliers')}>Cancel</Button>
            <Button type="submit" isLoading={mutation.isPending}>Create Supplier</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
