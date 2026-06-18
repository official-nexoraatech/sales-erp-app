import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Edit, ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { customerApi } from '../../../api/endpoints';
import { formatCurrency } from '../../../utils/formatCurrency';

export const CustomerViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const customerId = Number(id);

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customerApi.getById(customerId),
    enabled: !!customerId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader size="lg" />
      </div>
    );
  }

  const customerData = customer?.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Details"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate('/contacts/customers')}
              className="flex items-center gap-2"
            >
              <ArrowLeft size={18} />
              Back
            </Button>
            <Button
              onClick={() =>
                navigate(`/contacts/customers/${customerId}/edit`)
              }
              className="flex items-center gap-2"
            >
              <Edit size={18} />
              Edit
            </Button>
          </div>
        }
      />

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-600 font-medium">Customer Name</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.companyName || `${customerData?.firstName || ''} ${customerData?.lastName || ''}`.trim() || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Customer Code</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{customerData?.customerCode || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Email</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.email || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Phone</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.mobile || customerData?.phone || 'N/A'}
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="text-sm text-gray-600 font-medium">Address</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {[customerData?.billingAddress?.addressLine1, customerData?.billingAddress?.addressLine2].filter(Boolean).join(', ') || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">City</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.billingAddress?.city || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">State</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.billingAddress?.stateName || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Zip Code</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.billingAddress?.pincode || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Country</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.billingAddress?.countryName || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">GST Number</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {customerData?.gstNumber || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Credit Limit</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {formatCurrency(customerData?.creditLimit || 0)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 font-medium">Current Balance</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">
              {formatCurrency(customerData?.currentBalance || 0)}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
