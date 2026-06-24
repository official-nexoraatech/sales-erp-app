import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { warehouseApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';

export const WarehouseViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({ queryKey: ['warehouse', id], queryFn: () => warehouseApi.getById(id), enabled: id > 0 });

  if (isLoading) return <div className="p-10"><Loader /></div>;
  const warehouse = data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title={warehouse?.name || 'Warehouse'} actions={<Button variant="secondary" onClick={() => navigate('/warehouses')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div><p className="text-sm text-gray-500">Name</p><p className="font-semibold">{warehouse?.name || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Code</p><p className="font-semibold">{warehouse?.warehouseCode || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Status</p><p className="font-semibold">{String(warehouse?.status ?? 'N/A')}</p></div>
          <div><p className="text-sm text-gray-500">Address</p><p className="font-semibold">{warehouse?.address || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-sm text-gray-500">Description</p><p className="font-semibold">{warehouse?.description || 'N/A'}</p></div>
        </div>
      </Card>
    </div>
  );
};
