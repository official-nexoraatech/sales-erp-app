import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Edit } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supplierApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { PageHeader } from '../../../components/ui/PageHeader';
import { formatCurrency } from '../../../utils/formatCurrency';

export const SupplierViewPage: React.FC = () => {
  const navigate = useNavigate();
  const supplierId = Number(useParams<{ id: string }>().id);
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', supplierId],
    queryFn: () => supplierApi.getById(supplierId),
    enabled: Number.isFinite(supplierId) && supplierId > 0,
  });

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader size="lg" /></div>;

  const supplier = data?.data;
  const fields = [
    ['Email', supplier?.email],
    ['Mobile', supplier?.mobile],
    ['GST Number', supplier?.gstNumber],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Details"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/contacts/suppliers')} className="flex items-center gap-2"><ArrowLeft size={18} />Back</Button>
            <Button onClick={() => navigate(`/contacts/suppliers/${supplierId}/edit`)} className="flex items-center gap-2"><Edit size={18} />Edit</Button>
          </div>
        }
      />
      <Card>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div><p className="text-sm font-medium text-gray-600">Supplier Name</p><p className="mt-1 text-lg font-semibold text-gray-900">{supplier?.companyName || `${supplier?.firstName || ''} ${supplier?.lastName || ''}`.trim() || 'N/A'}</p></div>
          <div><p className="text-sm font-medium text-gray-600">Supplier Code</p><p className="mt-1 text-lg font-semibold text-gray-900">{supplier?.supplierCode || 'N/A'}</p></div>
          {fields.map(([label, value]) => (
            <div key={label}><p className="text-sm font-medium text-gray-600">{label}</p><p className="mt-1 text-lg font-semibold text-gray-900">{value || 'N/A'}</p></div>
          ))}
          <div><p className="text-sm font-medium text-gray-600">Credit Limit</p><p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(supplier?.creditLimit || 0)}</p></div>
          <div><p className="text-sm font-medium text-gray-600">Opening Balance</p><p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(supplier?.openingBalance || 0)}</p></div>
          <div><p className="text-sm font-medium text-gray-600">Current Balance</p><p className="mt-1 text-lg font-semibold text-gray-900">{formatCurrency(supplier?.currentBalance || 0)}</p></div>
        </div>
      </Card>
    </div>
  );
};
