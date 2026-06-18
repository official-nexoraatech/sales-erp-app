import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supplierApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { SupplierForm } from './SupplierForm';
import { supplierSchema, toSupplierRequest } from './supplier.schema';
import type { SupplierFormData, SupplierFormInput } from './supplier.schema';

export const SupplierEditPage: React.FC = () => {
  const navigate = useNavigate();
  const supplierId = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', supplierId],
    queryFn: () => supplierApi.getById(supplierId),
    enabled: Number.isFinite(supplierId) && supplierId > 0,
  });
  const { register, setValue, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormInput, unknown, SupplierFormData>({ resolver: zodResolver(supplierSchema) });

  React.useEffect(() => {
    if (data?.data) {
      const supplier = data.data;
      reset({
        companyName: supplier.companyName || '',
        firstName: supplier.firstName || '',
        lastName: supplier.lastName || '',
        email: supplier.email || '',
        phone: '',
        mobile: supplier.mobile || '',
        whatsappNo: '',
        gstNumber: supplier.gstNumber || '',
        creditLimit: supplier.creditLimit,
        openingBalance: supplier.openingBalance,
        state: '',
        status: 'ACTIVE',
        isDefaultSupplier: false,
        billingAddress: '',
        shippingName: '',
        shippingMobile: '',
        shippingEmail: '',
        shippingGstin: '',
        shippingAddress: '',
      });
    }
  }, [data?.data, reset]);

  const mutation = useMutation({
    mutationFn: (formData: SupplierFormData) => supplierApi.update(supplierId, toSupplierRequest(formData)),
    onSuccess: () => {
      toast.success('Supplier updated successfully');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/contacts/suppliers');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update supplier'),
  });

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader size="lg" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Supplier" description="Update supplier information" />
      <Card>
        <form onSubmit={handleSubmit((formData) => mutation.mutate(formData))} className="space-y-6">
          <SupplierForm register={register} setValue={setValue} errors={errors} />
          <div className="flex justify-end gap-3 border-t pt-6">
            <Button type="button" variant="secondary" onClick={() => navigate('/contacts/suppliers')}>Cancel</Button>
            <Button type="submit" isLoading={mutation.isPending}>Update Supplier</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
