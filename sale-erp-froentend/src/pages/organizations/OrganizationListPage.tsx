import React, { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Plus, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { organizationApi } from '../../api/endpoints';
import type { Organization } from '../../api/endpoints';
import { CONSTANTS } from '../../app/constants';
import { queryClient } from '../../app/queryClient';
import { DataTable } from '../../components/common/DataTable';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PageHeader } from '../../components/ui/PageHeader';
import { useDebounce } from '../../hooks/useDebounce';
import { usePagination } from '../../hooks/usePagination';
import {
  formatOrganizationAddress,
  getOrganizationId,
  getOrganizationStatus,
  getUploadedOrganizationLogoUrl,
  toUpdateOrganizationRequest,
} from './organization.utils';
import { useAuth } from '../../hooks/useAuth';
import { PERMISSIONS } from '../../auth/permissions';

export const OrganizationListPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.ORGANIZATION_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.ORGANIZATION_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.ORGANIZATION_DELETE);
  const { page, setPage, handlePageChange } = usePagination();
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const logoInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const debouncedSearch = useDebounce(search);

  const organizations = useQuery({
    queryKey: ['organizations', debouncedSearch],
    queryFn: () => organizationApi.getAll(debouncedSearch),
  });

  const allRows = organizations.data?.data?.content || [];
  const rows = allRows.slice(page * CONSTANTS.ITEMS_PER_PAGE, page * CONSTANTS.ITEMS_PER_PAGE + CONSTANTS.ITEMS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(allRows.length / CONSTANTS.ITEMS_PER_PAGE));

  const deleteMutation = useMutation({
    mutationFn: (id: number) => organizationApi.delete(id),
    onSuccess: async () => {
      toast.success('Organization deleted successfully');
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete organization'),
  });

  const logoMutation = useMutation({
    mutationFn: async ({ organization, file }: { organization: Organization; file: File }) => {
      const id = getOrganizationId(organization);
      const uploadResponse = await organizationApi.uploadLogo(id, file);
      const logoUrl = getUploadedOrganizationLogoUrl(uploadResponse);
      if (!logoUrl) throw new Error('Logo upload did not return a URL');
      await organizationApi.update(id, toUpdateOrganizationRequest(organization, logoUrl));
    },
    onSuccess: async () => {
      toast.success('Organization logo updated successfully');
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to update organization logo'),
  });

  const uploadLogo = (organization: Organization, file: File | undefined) => {
    if (!file) return;
    logoMutation.mutate({ organization, file });
  };

  const columns = [
    {
      key: 'logoUrl',
      header: 'Logo',
      render: (value: string | null, record: Organization) => (
        value ? (
          <img src={value} alt={`${record.name} logo`} className="h-10 w-10 rounded border border-gray-200 object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">NA</span>
        )
      ),
      width: '80px',
    },
    { key: 'name', header: 'Name' },
    { key: 'description', header: 'Description', render: (value: string) => <span className="block max-w-xs truncate">{value || 'N/A'}</span> },
    { key: 'address', header: 'Address', render: (_value: Organization['address'], record: Organization) => <span className="block max-w-xs truncate">{formatOrganizationAddress(record.address)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (value: Organization['status']) => {
        const status = getOrganizationStatus(value);
        return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{status}</span>;
      },
    },
    {
      key: 'id',
      header: 'Actions',
      render: (_value: number, record: Organization) => {
        const id = getOrganizationId(record);
        return (
          <div className="flex gap-2">
            <button
              type="button"
              title="View organization"
              aria-label="View organization"
              onClick={() => navigate(`/organizations/${id}`)}
              className="rounded p-1 text-blue-600 hover:bg-blue-50"
            >
              <Eye size={18} />
            </button>
            {canUpdate && (
              <>
                <input
                  ref={(element) => {
                    logoInputRefs.current[id] = element;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    uploadLogo(record, event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
                <button
                  type="button"
                  title="Upload logo"
                  aria-label="Upload organization logo"
                  disabled={logoMutation.isPending}
                  onClick={() => logoInputRefs.current[id]?.click()}
                  className="rounded p-1 text-violet-600 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload size={18} />
                </button>
                <button type="button" title="Edit organization" aria-label="Edit organization" onClick={() => navigate(`/organizations/${id}/edit`, { state: record })} className="rounded p-1 text-orange-600 hover:bg-orange-50">
                  <Edit size={18} />
                </button>
              </>
            )}
            {canDelete && <button type="button" title="Delete organization" aria-label="Delete organization" onClick={() => setDeleteId(id)} className="rounded p-1 text-red-600 hover:bg-red-50">
              <Trash2 size={18} />
            </button>}
          </div>
        );
      },
      width: '120px',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        actions={canCreate ? <Button onClick={() => navigate('/organizations/create')} className="flex w-full items-center justify-center gap-2 sm:w-auto"><Plus size={18} />New Organization</Button> : undefined}
      />

      <DataTable
        columns={columns}
        data={rows}
        isLoading={organizations.isLoading}
        totalPages={totalPages}
        currentPage={page}
        onPageChange={handlePageChange}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        searchPlaceholder="Search organizations..."
      />

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete Organization"
        message="Are you sure you want to delete this organization? This action cannot be undone."
        onConfirm={() => deleteId !== null && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        isLoading={deleteMutation.isPending}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
};
