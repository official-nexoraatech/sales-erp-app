import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Edit, Globe, MapPin, Upload } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { organizationApi } from '../../api/endpoints';
import type { Organization } from '../../api/endpoints';
import { PERMISSIONS } from '../../auth/permissions';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { useAuth } from '../../hooks/useAuth';
import { formatOrganizationAddress, getOrganizationId, getOrganizationStatus, getOrganizationSubscribed } from './organization.utils';

const displayValue = (value?: React.ReactNode) => {
  if (value === undefined || value === null || value === '') {
    return <span className="font-normal text-gray-400 dark:text-slate-500">Not provided</span>;
  }
  return value;
};

const DetailField = ({ label, value, className = '' }: { label: string; value?: React.ReactNode; className?: string }) => (
  <div className={className}>
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</p>
    <div className="break-words text-sm font-semibold text-gray-900 dark:text-slate-100">{displayValue(value)}</div>
  </div>
);

const SectionTitle = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="mb-5 flex items-start gap-3 border-b border-gray-100 pb-4 dark:border-slate-700">
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
      {icon}
    </div>
    <div>
      <h2 className="font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">{description}</p>
    </div>
  </div>
);

export const OrganizationViewPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canUpdate = hasPermission(PERMISSIONS.ORGANIZATION_UPDATE);
  const organizationId = Number(useParams<{ id: string }>().id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['organizations-view', organizationId],
    queryFn: () => organizationApi.getAll(''),
    enabled: Number.isFinite(organizationId) && organizationId > 0,
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader size="lg" /></div>;
  }

  const organizations: Organization[] = data?.data?.content || [];
  const organization = organizations.find((org) => getOrganizationId(org) === organizationId);

  if (isError || !organization) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h1 className="text-lg font-semibold text-gray-900">Organization not found</h1>
        <p className="mt-2 text-sm text-gray-500">The requested organization could not be loaded.</p>
        <Button className="mt-5" variant="outline" onClick={() => navigate('/organizations')}>
          <ArrowLeft size={17} /> Back to Organizations
        </Button>
      </Card>
    );
  }

  const status = getOrganizationStatus(organization.status);
  const subscribed = getOrganizationSubscribed(organization.isSubscribed);
  const address = formatOrganizationAddress(organization.address);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 sm:text-3xl">Organization Details</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Complete organization profile and address information</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/organizations')}>
            <ArrowLeft size={18} /> Back
          </Button>
          {canUpdate && (
            <Button onClick={() => navigate(`/organizations/${organizationId}/edit`, { state: organization })}>
              <Edit size={18} /> Edit Organization
            </Button>
          )}
        </div>
      </div>

      {/* Identity Banner */}
      <Card className="overflow-hidden border border-gray-100 shadow-sm dark:border-slate-700">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {organization.logoUrl ? (
              <img
                src={organization.logoUrl}
                alt={`${organization.name} logo`}
                className="h-16 w-16 shrink-0 rounded-xl border border-gray-200 object-cover shadow-sm dark:border-slate-600"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-sm">
                {organization.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold text-gray-900 dark:text-slate-100">{organization.name}</h2>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'ACTIVE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400'}`}>
                  {status}
                </span>
              </div>
              {organization.description && (
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{organization.description}</p>
              )}
            </div>
          </div>
          {canUpdate && (
            <Button
              variant="outline"
              onClick={() => navigate(`/organizations/${organizationId}/edit`, { state: organization })}
              className="shrink-0"
            >
              <Upload size={16} /> Update Logo
            </Button>
          )}
        </div>
      </Card>

      {/* Details Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="border border-gray-100 shadow-sm dark:border-slate-700">
          <SectionTitle
            icon={<Building2 size={20} />}
            title="Organization Information"
            description="Basic details and description"
          />
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <DetailField label="Organization Name" value={organization.name} className="sm:col-span-2" />
            <DetailField label="Description" value={organization.description} className="sm:col-span-2" />
            <DetailField label="Phone" value={organization.phone} />
            <DetailField label="GSTIN" value={organization.gstNumber} />
            <DetailField
              label="Status"
              value={
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {status}
                </span>
              }
            />
            <DetailField
              label="Subscription"
              value={
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${subscribed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {subscribed ? 'Subscribed' : 'Not Subscribed'}
                </span>
              }
            />
            {organization.createdBy && <DetailField label="Created By" value={organization.createdBy} />}
            {organization.createdAt && <DetailField label="Created At" value={new Date(organization.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} />}
          </div>
        </Card>

        <Card className="border border-gray-100 shadow-sm dark:border-slate-700">
          <SectionTitle
            icon={<MapPin size={20} />}
            title="Address"
            description="Organization registered address"
          />
          {address && address !== 'N/A' ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              {typeof organization.address === 'object' && organization.address !== null && !Array.isArray(organization.address) ? (
                <>
                  <DetailField label="Address Line 1" value={(organization.address as any).addressLine1} className="sm:col-span-2" />
                  <DetailField label="Address Line 2" value={(organization.address as any).addressLine2} className="sm:col-span-2" />
                  <DetailField label="City" value={(organization.address as any).city} />
                  <DetailField label="State" value={(organization.address as any).stateName} />
                  <DetailField label="Pincode" value={(organization.address as any).pincode} />
                </>
              ) : (
                <DetailField label="Full Address" value={address} className="sm:col-span-2" />
              )}
            </div>
          ) : (
            <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center dark:border-slate-600 dark:bg-slate-800/50">
              <Globe size={24} className="mb-2 text-gray-300" />
              <p className="text-sm font-medium text-gray-500">No address added</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
