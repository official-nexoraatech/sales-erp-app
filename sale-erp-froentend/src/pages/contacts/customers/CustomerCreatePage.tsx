import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { PageHeader } from '../../../components/ui/PageHeader';
import { CustomerForm } from './CustomerForm';
import { customerSchema, toCustomerRequest } from './customer.schema';
import type { CustomerFormData, CustomerFormInput } from './customer.schema';

export const CustomerCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const backPath = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/contacts/customers';
  const { register, control, setValue, handleSubmit, formState: { errors } } = useForm<CustomerFormInput, unknown, CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      openingBalanceType: '',
      isWholesale: false,
      billingAddress: { stateId: 0, countryId: 0 },
      shippingAddress: { stateId: 0, countryId: 0 },
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CustomerFormData) => customerApi.create(toCustomerRequest(data)),
    onSuccess: () => {
      toast.success('Customer created successfully');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['pos-customers'] });
      navigate(backPath);
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to create customer'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Create Customer" description="Add a new customer to your system" />
      <Card>
        <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
          <CustomerForm register={register} control={control} setValue={setValue} errors={errors} />
          <div className="flex justify-end gap-3 border-t pt-6">
            <Button type="button" variant="secondary" onClick={() => navigate(backPath)}>Cancel</Button>
            <Button type="submit" isLoading={mutation.isPending}>Create Customer</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
