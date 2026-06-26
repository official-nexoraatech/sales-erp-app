import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Edit,
  Mail,
  Phone,
  ReceiptText,
  User,
  WalletCards,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { supplierApi } from '../../../api/endpoints';
import { PERMISSIONS } from '../../../auth/permissions';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { useAuth } from '../../../hooks/useAuth';
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

export const SupplierViewPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.SUPPLIER_UPDATE);
  const supplierId = Number(useParams<{ id: string }>().id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['suppliers', supplierId],
    queryFn: () => supplierApi.getById(supplierId),
    enabled: Number.isFinite(supplierId) && supplierId > 0,
  });

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader size="lg" /></div>;
  }

  const supplier = data?.data;

  if (isError || !supplier) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-lg font-semibold text-gray-900">Supplier not found</h1>
        <p className="mt-2 text-sm text-gray-500">The requested supplier could not be loaded.</p>
        <Button className="mt-5" variant="outline" onClick={() => navigate('/contacts/suppliers')}>
          <ArrowLeft size={17} /> Back to Suppliers
        </Button>
      </Card>
    );
  }

  const fullName = `${supplier.firstName || ''} ${supplier.lastName || ''}`.trim();
  const displayName = fullName || 'Supplier';
  const initials = (fullName || supplier.supplierCode)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Supplier Details</h1>
          <p className="mt-1 text-sm text-gray-600">Complete supplier profile, tax information, and account balances</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/contacts/suppliers')}>
            <ArrowLeft size={18} /> Back
          </Button>
          {canUpdate && <Button onClick={() => navigate(`/contacts/suppliers/${supplierId}/edit`)}>
            <Edit size={18} /> Edit Supplier
          </Button>}
        </div>
      </div>

      <Card className="overflow-hidden border border-gray-100 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-sm">
              {initials || 'SU'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-gray-900">{displayName}</h2>
                <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">
                  Supplier
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Supplier code: <span className="font-semibold text-gray-700">{supplier.supplierCode}</span>
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-5 py-3 sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Current Balance</p>
            <p className="mt-1 text-2xl font-bold text-blue-700">{formatCurrency(supplier.currentBalance ?? 0)}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<User size={20} />}
            title="Supplier Information"
            description="Identity and contact information"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField label="First Name" value={supplier.firstName} />
            <DetailField label="Last Name" value={supplier.lastName} />
            <DetailField
              label="Email Address"
              value={supplier.email ? (
                <a className="inline-flex items-center gap-2 text-blue-600 hover:underline" href={`mailto:${supplier.email}`}>
                  <Mail size={15} /> {supplier.email}
                </a>
              ) : undefined}
            />
            <DetailField
              label="Mobile Number"
              value={supplier.mobile ? (
                <a className="inline-flex items-center gap-2 text-blue-600 hover:underline" href={`tel:${supplier.mobile}`}>
                  <Phone size={15} /> {supplier.mobile}
                </a>
              ) : undefined}
            />
          </div>
        </Card>

        <Card className="border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<ReceiptText size={20} />}
            title="Business & Tax Information"
            description="Supplier registration and account identification"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField label="Supplier Code" value={supplier.supplierCode} />
            <DetailField
              label="Contact Type"
              value={<span className="inline-flex items-center gap-2"><Building2 size={15} className="text-orange-600" />Supplier</span>}
            />
            <DetailField label="GST Number" value={supplier.gstNumber} className="sm:col-span-2" />
          </div>
        </Card>
      </div>

      <Card className="border border-gray-100 shadow-sm">
        <SectionTitle
          icon={<WalletCards size={20} />}
          title="Financial Summary"
          description="Supplier credit and payable balances"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FinancialSummary label="Credit Limit" value={supplier.creditLimit ?? 0} />
          <FinancialSummary label="Opening Balance" value={supplier.openingBalance ?? 0} />
          <FinancialSummary label="Current Balance" value={supplier.currentBalance ?? 0} emphasis />
        </div>
      </Card>
    </div>
  );
};
