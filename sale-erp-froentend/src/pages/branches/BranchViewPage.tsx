import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { branchApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';

export const BranchViewPage: React.FC = () => {
  const navigate = useNavigate();
  const id = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({ queryKey: ['branch', id], queryFn: () => branchApi.getById(id), enabled: id > 0 });

  if (isLoading) return <div className="p-10"><Loader /></div>;
  const branch = data?.data;

  return (
    <div className="space-y-6">
      <PageHeader title={branch?.branchName || 'Branch'} actions={<Button variant="secondary" onClick={() => navigate('/branches')}>Back</Button>} />
      <Card>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div><p className="text-sm text-gray-500">Branch Code</p><p className="font-semibold">{branch?.branchCode || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Branch Name</p><p className="font-semibold">{branch?.branchName || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Status</p><p className="font-semibold">{branch?.isActive ? 'Active' : 'Inactive'}</p></div>
          <div><p className="text-sm text-gray-500">Email</p><p className="font-semibold">{branch?.email || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Phone</p><p className="font-semibold">{branch?.phone || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">City</p><p className="font-semibold">{branch?.city || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">State</p><p className="font-semibold">{branch?.state || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Country</p><p className="font-semibold">{branch?.country || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">Pincode</p><p className="font-semibold">{branch?.pincode || 'N/A'}</p></div>
          <div><p className="text-sm text-gray-500">GST Number</p><p className="font-semibold">{branch?.gstNumber || 'N/A'}</p></div>
          <div className="md:col-span-2"><p className="text-sm text-gray-500">Address</p><p className="font-semibold">{branch?.address || 'N/A'}</p></div>
        </div>
      </Card>
    </div>
  );
};
