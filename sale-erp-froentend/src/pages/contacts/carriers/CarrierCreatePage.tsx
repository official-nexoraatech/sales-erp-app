import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { carrierApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { CarrierForm } from './CarrierForm';
import { carrierSchema } from './carrier.schema';
import type { CarrierFormData } from './carrier.schema';

export const CarrierCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { register, setValue, handleSubmit, formState: { errors } } = useForm<CarrierFormData>({ resolver: zodResolver(carrierSchema), defaultValues: { status: 'ACTIVE' } });
  const mutation = useMutation({ mutationFn: carrierApi.create, onSuccess: () => { toast.success('Carrier created successfully'); queryClient.invalidateQueries({ queryKey: ['carriers'] }); navigate('/contacts/carriers'); }, onError: (error: any) => toast.error(error?.message || 'Carrier API is unavailable') });
  return <div className="space-y-5"><div className="text-sm text-gray-500">Home › Contacts › Carrier List › <span className="text-gray-700">Create Carrier</span></div><Card className="overflow-hidden p-0"><h1 className="border-b px-5 py-4 text-xl font-semibold">Carrier Details</h1><form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6"><div className="px-5 pt-2"><CarrierForm register={register} setValue={setValue} errors={errors} /></div><div className="flex justify-end gap-3 border-t px-5 py-4"><Button type="button" variant="secondary" onClick={() => navigate('/contacts/carriers')}>Cancel</Button><Button type="submit" isLoading={mutation.isPending}>Create Carrier</Button></div></form></Card></div>;
};
