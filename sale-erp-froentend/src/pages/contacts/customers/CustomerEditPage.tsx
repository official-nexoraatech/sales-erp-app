import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { CustomerForm } from './CustomerForm';
import { customerSchema, toCustomerRequest } from './customer.schema';
import type { CustomerFormData, CustomerFormInput } from './customer.schema';

export const CustomerEditPage: React.FC = () => {
  const navigate = useNavigate();
  const customerId = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customerApi.getById(customerId),
    enabled: Number.isFinite(customerId) && customerId > 0,
  });
  const { register, control, setValue, handleSubmit, reset, formState: { errors } } = useForm<CustomerFormInput, unknown, CustomerFormData>({ resolver: zodResolver(customerSchema) });

  React.useEffect(() => {
    if (!data?.data) return;
    const customer = data.data;
    const toAddress = (address = customer.billingAddress) => ({
      addressLine1: address?.addressLine1 || '',
      addressLine2: address?.addressLine2 || '',
      city: address?.city || '',
      stateId: address?.stateId || 0,
      countryId: address?.countryId || 0,
      pincode: address?.pincode || '',
    });
    reset({
      companyName: customer.companyName || '',
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      mobile: customer.mobile || '',
      whatsappNo: customer.whatsappNo || customer.mobile || '',
      gstNumber: customer.gstNumber || '',
      panNumber: customer.panNumber || '',
      creditLimit: customer.creditLimit,
      openingBalance: customer.openingBalance,
      openingBalanceType: customer.openingBalanceType || '',
      isWholesale: customer.isWholesale,
      billingAddress: toAddress(customer.billingAddress),
      shippingAddress: toAddress(customer.shippingAddress),
    });
  }, [data?.data, reset]);

  const mutation = useMutation({
    mutationFn: (formData: CustomerFormData) => customerApi.update(customerId, toCustomerRequest(formData)),
    onSuccess: () => {
      toast.success('Customer updated successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      navigate('/contacts/customers');
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update customer'),
  });

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader size="lg" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Customer" description="Update customer information" />
      <Card>
        <form onSubmit={handleSubmit((formData) => mutation.mutate(formData))} className="space-y-6">
          <CustomerForm register={register} control={control} setValue={setValue} errors={errors} />
          <div className="flex justify-end gap-3 border-t pt-6">
            <Button type="button" variant="secondary" onClick={() => navigate('/contacts/customers')}>Cancel</Button>
            <Button type="submit" isLoading={mutation.isPending}>Update Customer</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
