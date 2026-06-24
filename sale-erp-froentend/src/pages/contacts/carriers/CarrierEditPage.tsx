import React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { carrierApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { CarrierForm } from './CarrierForm';
import { carrierSchema } from './carrier.schema';
import type { CarrierFormData } from './carrier.schema';

export const CarrierEditPage: React.FC = () => {
  const navigate = useNavigate(); const id = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({ queryKey: ['carriers', id], queryFn: () => carrierApi.getById(id), enabled: id > 0 });
  const { register, setValue, handleSubmit, reset, formState: { errors } } = useForm<CarrierFormData>({ resolver: zodResolver(carrierSchema) });
  React.useEffect(() => { if (data?.data) reset({ ...data.data, whatsappNo: data.data.whatsappNo || data.data.mobile || '', status: data.data.status || 'ACTIVE' }); }, [data?.data, reset]);
  const mutation = useMutation({ mutationFn: (payload: CarrierFormData) => carrierApi.update(id, payload), onSuccess: () => { toast.success('Carrier updated successfully'); queryClient.invalidateQueries({ queryKey: ['carriers'] }); navigate('/contacts/carriers'); }, onError: (error: any) => toast.error(error?.message || 'Carrier API is unavailable') });
  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader /></div>;
  return <Card><h1 className="mb-6 text-xl font-semibold">Edit Carrier</h1><form onSubmit={handleSubmit((payload) => mutation.mutate(payload))} className="space-y-6"><CarrierForm register={register} setValue={setValue} errors={errors} /><div className="flex justify-end gap-3 border-t pt-5"><Button type="button" variant="secondary" onClick={() => navigate('/contacts/carriers')}>Cancel</Button><Button type="submit" isLoading={mutation.isPending}>Update Carrier</Button></div></form></Card>;
};
