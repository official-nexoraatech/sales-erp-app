import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { carrierApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';

export const CarrierViewPage: React.FC = () => {
  const navigate = useNavigate(); const id = Number(useParams<{ id: string }>().id);
  const { data, isLoading, isError } = useQuery({ queryKey: ['carriers', id], queryFn: () => carrierApi.getById(id), enabled: id > 0 });
  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader /></div>;
  if (isError) return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">Carrier API is currently unavailable.</div>;
  const carrier = data?.data;
  return <div className="space-y-6"><PageHeader title="Carrier Details" actions={<Button onClick={() => navigate(`/contacts/carriers/${id}/edit`)}>Edit</Button>} /><Card><div className="grid grid-cols-1 gap-6 md:grid-cols-2">{[['Name', carrier?.name], ['Mobile', carrier?.mobile], ['WhatsApp', carrier?.whatsappNo], ['Email', carrier?.email], ['Status', carrier?.status], ['Address', carrier?.address], ['Note', carrier?.note]].map(([label, value]) => <div key={label}><p className="text-sm text-gray-500">{label}</p><p className="mt-1 font-semibold text-gray-900">{value || 'N/A'}</p></div>)}</div></Card></div>;
};
