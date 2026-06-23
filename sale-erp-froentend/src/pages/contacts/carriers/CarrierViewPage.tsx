import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  Edit,
  FileText,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Truck,
  UserRound,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { carrierApi } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Loader } from '../../../components/ui/Loader';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSIONS } from '../../../auth/permissions';

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
  tone = 'blue',
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tone?: 'blue' | 'orange';
}) => (
  <div className="mb-5 flex items-start gap-3 border-b border-gray-100 pb-4">
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
      tone === 'orange' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'
    }`}>
      {icon}
    </div>
    <div>
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p className="mt-0.5 text-sm text-gray-500">{description}</p>
    </div>
  </div>
);

export const CarrierViewPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.CARRIER_UPDATE);
  const carrierId = Number(useParams<{ id: string }>().id);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['carriers', carrierId],
    queryFn: () => carrierApi.getById(carrierId),
    enabled: Number.isFinite(carrierId) && carrierId > 0,
  });

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center"><Loader size="lg" /></div>;
  }

  const carrier = data?.data;

  if (isError || !carrier) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-lg font-semibold text-gray-900">Carrier not found</h1>
        <p className="mt-2 text-sm text-gray-500">The requested carrier could not be loaded.</p>
        <Button className="mt-5" variant="outline" onClick={() => navigate('/contacts/carriers')}>
          <ArrowLeft size={17} /> Back to Carriers
        </Button>
      </Card>
    );
  }

  const isActive = carrier.status !== 'INACTIVE';
  const initials = carrier.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Carrier Details</h1>
          <p className="mt-1 text-sm text-gray-600">Complete carrier profile, contact information, address, and notes</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/contacts/carriers')}>
            <ArrowLeft size={18} /> Back
          </Button>
          {canUpdate && <Button onClick={() => navigate(`/contacts/carriers/${carrierId}/edit`)}>
            <Edit size={18} /> Edit Carrier
          </Button>}
        </div>
      </div>

      <Card className="overflow-hidden border border-gray-100 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-sm">
              {initials || 'CA'}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-gray-900">{carrier.name}</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">
                  <Truck size={13} /> Carrier
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">Shipping and transportation partner</p>
            </div>
          </div>
          <div className={`inline-flex w-fit items-center gap-2 rounded-lg border px-4 py-3 ${
            isActive
              ? 'border-green-100 bg-green-50 text-green-700'
              : 'border-red-100 bg-red-50 text-red-700'
          }`}>
            {isActive ? <CircleCheck size={20} /> : <CircleX size={20} />}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Status</p>
              <p className="font-bold">{isActive ? 'Active' : 'Inactive'}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<UserRound size={20} />}
            title="Carrier Information"
            description="Carrier identity and operational status"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField label="Carrier Name" value={carrier.name} className="sm:col-span-2" />
            <DetailField
              label="Carrier Type"
              value={<span className="inline-flex items-center gap-2"><Truck size={15} className="text-orange-600" />Shipping Carrier</span>}
            />
            <DetailField
              label="Status"
              value={(
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                  isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {isActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
              )}
            />
          </div>
        </Card>

        <Card className="border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<Phone size={20} />}
            title="Contact Information"
            description="Phone, WhatsApp, and email details"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField
              label="Mobile Number"
              value={carrier.mobile ? (
                <a className="inline-flex items-center gap-2 text-blue-600 hover:underline" href={`tel:${carrier.mobile}`}>
                  <Phone size={15} /> {carrier.mobile}
                </a>
              ) : undefined}
            />
            <DetailField
              label="WhatsApp Number"
              value={carrier.whatsappNo ? (
                <span className="inline-flex items-center gap-2">
                  <MessageCircle size={15} className="text-green-600" /> {carrier.whatsappNo}
                </span>
              ) : undefined}
            />
            <DetailField
              label="Email Address"
              className="sm:col-span-2"
              value={carrier.email ? (
                <a className="inline-flex items-center gap-2 text-blue-600 hover:underline" href={`mailto:${carrier.email}`}>
                  <Mail size={15} /> {carrier.email}
                </a>
              ) : undefined}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="h-full border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<MapPin size={20} />}
            title="Carrier Address"
            description="Primary carrier location"
            tone="orange"
          />
          {carrier.address ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">{carrier.address}</p>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center">
              <MapPin size={24} className="mb-2 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No carrier address added</p>
            </div>
          )}
        </Card>

        <Card className="h-full border border-gray-100 shadow-sm">
          <SectionTitle
            icon={<FileText size={20} />}
            title="Notes"
            description="Additional carrier information"
          />
          {carrier.note ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-gray-700">{carrier.note}</p>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center">
              <FileText size={24} className="mb-2 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No notes added</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
