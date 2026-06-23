import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Edit,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  ReceiptText,
  User,
  WalletCards,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { customerApi } from '../../../api/endpoints';
import type { CustomerAddress } from '../../../types/customer.types';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { formatCurrency } from '../../../utils/formatCurrency';

const displayValue = (value?: React.ReactNode) => {
  if (value === undefined || value === null || value === '') {
    return <span className="font-normal text-gray-400">Not provided</span>;
  }
  return value;
};

const DetailField = ({
  label,
  value,
  className = '',
}: {
  label: string;
  value?: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    <div className="break-words text-sm font-semibold text-gray-900">{displayValue(value)}</div>
  </div>
);

const SectionTitle = ({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) => (
  <div className="mb-5 flex items-start gap-3 border-b border-gray-100 pb-4">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
      {icon}
    </div>
    <div>
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p className="mt-0.5 text-sm text-gray-500">{description}</p>
    </div>
  </div>
);

const AddressCard = ({
  title,
  address,
}: {
  title: string;
  address?: CustomerAddress;
}) => (
  <Card className="h-full border border-gray-100 shadow-sm">
    <div className="mb-5 flex items-center gap-3 border-b border-gray-100 pb-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
        <MapPin size={20} />
      </div>
      <div>
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500">Customer {title.toLowerCase()}</p>
      </div>
    </div>

    {address ? (
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <DetailField label="Address Line 1" value={address.addressLine1} className="sm:col-span-2" />
        <DetailField label="Address Line 2" value={address.addressLine2} className="sm:col-span-2" />
        <DetailField label="City" value={address.city} />
        <DetailField label="State" value={address.stateName} />
        <DetailField label="Pincode" value={address.pincode} />
        <DetailField label="Country" value={address.countryName} />
      </div>
    ) : (
      <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center">
        <MapPin size={24} className="mb-2 text-gray-300" />
        <p className="text-sm font-medium text-gray-500">No {title.toLowerCase()} added</p>
      </div>
    )}
  </Card>
);

const FinancialSummary = ({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) => (
  <div className={`rounded-lg border p-4 ${emphasis ? 'border-blue-100 bg-blue-50' : 'border-gray-100 bg-gray-50'}`}>
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
    <p className={`mt-2 text-xl font-bold ${emphasis ? 'text-blue-700' : 'text-gray-900'}`}>
      {formatCurrency(value)}
    </p>
  </div>
);

export const CustomerViewPage: React.FC = () => {
  const navigate = useNavigate();
  const customerId = Number(useParams<{ id: string }>().id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => customerApi.getById(customerId),
    enabled: Number.isFinite(customerId) && customerId > 0,
  });

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader size="lg" /></div>;
  }

  const customer = data?.data;

  if (isError || !customer) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-lg font-semibold text-gray-900">Customer not found</h1>
        <p className="mt-2 text-sm text-gray-500">The requested customer could not be loaded.</p>
        <Button className="mt-5" variant="outline" onClick={() => navigate('/contacts/customers')}>
          <ArrowLeft size={17} /> Back to Customers
        </Button>
      </Card>
    );
  }

  const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
  const displayName = customer.companyName || fullName || 'Customer';
  const initials = (customer.companyName || fullName || customer.customerCode)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Customer Details</h1>
          <p className="mt-1 text-sm text-gray-600">Complete customer profile, balances, tax information, and addresses</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/contacts/customers')}>
            <ArrowLeft size={18} /> Back
          </Button>
          <Button onClick={() => navigate(`/contacts/customers/${customerId}/edit`)}>
            <Edit size={18} /> Edit Customer
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden border border-gray-100 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-sm">
              {initials || 'CU'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-gray-900">{displayName}</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${customer.isWholesale ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                  {customer.isWholesale ? 'Wholesale' : 'Retail'}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Customer code: <span className="font-semibold text-gray-700">{customer.customerCode}</span>
              </p>
              {customer.companyName && fullName && <p className="mt-1 text-sm text-gray-600">Contact person: {fullName}</p>}
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-5 py-3 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Current Balance</p>
            <p className="mt-1 text-2xl font-bold text-blue-700">{formatCurrency(customer.currentBalance ?? 0)}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<User size={20} />}
            title="Customer Information"
            description="Identity and contact information"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField label="First Name" value={customer.firstName} />
            <DetailField label="Last Name" value={customer.lastName} />
            <DetailField label="Company Name" value={customer.companyName} className="sm:col-span-2" />
            <DetailField
              label="Email Address"
              value={customer.email ? (
                <a className="inline-flex items-center gap-2 text-blue-600 hover:underline" href={`mailto:${customer.email}`}>
                  <Mail size={15} /> {customer.email}
                </a>
              ) : undefined}
            />
            <DetailField
              label="Mobile Number"
              value={customer.mobile ? (
                <a className="inline-flex items-center gap-2 text-blue-600 hover:underline" href={`tel:${customer.mobile}`}>
                  <Phone size={15} /> {customer.mobile}
                </a>
              ) : undefined}
            />
            <DetailField label="Phone Number" value={customer.phone} />
            <DetailField
              label="WhatsApp Number"
              value={customer.whatsappNo ? (
                <span className="inline-flex items-center gap-2"><MessageCircle size={15} className="text-green-600" />{customer.whatsappNo}</span>
              ) : undefined}
            />
          </div>
        </Card>

        <Card className="border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<ReceiptText size={20} />}
            title="Business & Tax Information"
            description="Registration and customer classification"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField label="Customer Code" value={customer.customerCode} />
            <DetailField
              label="Customer Type"
              value={customer.isWholesale ? 'Wholesale Customer' : 'Retail Customer'}
            />
            <DetailField label="GST Number" value={customer.gstNumber} />
            <DetailField label="PAN Number" value={customer.panNumber} />
            <DetailField
              label="Opening Balance Type"
              value={customer.openingBalanceType ? (
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                  customer.openingBalanceType === 'RECEIVABLE'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-orange-100 text-orange-700'
                }`}>
                  {customer.openingBalanceType}
                </span>
              ) : undefined}
            />
          </div>
        </Card>
      </div>

      <Card className="border border-gray-100 shadow-sm">
        <SectionTitle
          icon={<WalletCards size={20} />}
          title="Financial Summary"
          description="Customer limits and account balances"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FinancialSummary label="Credit Limit" value={customer.creditLimit ?? 0} />
          <FinancialSummary label="Opening Balance" value={customer.openingBalance ?? 0} />
          <FinancialSummary label="Current Balance" value={customer.currentBalance ?? 0} emphasis />
        </div>
      </Card>

      <div>
        <div className="mb-4 flex items-center gap-2">
          <Building2 size={20} className="text-gray-500" />
          <h2 className="text-lg font-semibold text-gray-900">Customer Addresses</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <AddressCard title="Billing Address" address={customer.billingAddress} />
          <AddressCard title="Shipping Address" address={customer.shippingAddress} />
        </div>
      </div>
    </div>
  );
};
