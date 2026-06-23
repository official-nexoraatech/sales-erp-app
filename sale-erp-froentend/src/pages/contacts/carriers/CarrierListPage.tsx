import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { carrierApi } from '../../../api/endpoints';
import { CONSTANTS } from '../../../app/constants';
import { queryClient } from '../../../app/queryClient';
import { DataTable } from '../../../components/common/DataTable';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePagination } from '../../../hooks/usePagination';
import { formatDate } from '../../../utils/formatDate';
import { useAuth } from '../../../hooks/useAuth';
import { PERMISSIONS } from '../../../auth/permissions';

export const CarrierListPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.CARRIER_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.CARRIER_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.CARRIER_DELETE);
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { page, handlePageChange } = usePagination();
  const debouncedSearch = useDebounce(search);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['carriers', page, debouncedSearch],
    queryFn: () => carrierApi.getAll({ page, size: CONSTANTS.ITEMS_PER_PAGE, search: debouncedSearch }),
  });
  const deletion = useMutation({
    mutationFn: (id: number) => carrierApi.delete(id),
    onSuccess: () => { toast.success('Carrier deleted successfully'); setDeleteId(null); queryClient.invalidateQueries({ queryKey: ['carriers'] }); },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete carrier'),
  });
  const columns = [
    { key: 'name', header: 'Name' }, { key: 'mobile', header: 'Mobile' },
    { key: 'whatsappNo', header: 'WhatsApp' }, { key: 'email', header: 'Email' },
    { key: 'status', header: 'Status', render: (value: string) => <span className={`rounded-full px-3 py-1 text-xs font-semibold ${value === 'INACTIVE' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{value || 'ACTIVE'}</span> },
    { key: 'createdBy', header: 'Created by' },
    { key: 'createdAt', header: 'Created at', render: (value: string) => value ? formatDate(value) : 'N/A' },
    { key: 'id', header: 'Action', render: (value: number) => <div className="flex gap-1"><button aria-label="View carrier" onClick={() => navigate(`/contacts/carriers/${value}`)} className="p-1 text-blue-600"><Eye size={17} /></button>{canUpdate && <button aria-label="Edit carrier" onClick={() => navigate(`/contacts/carriers/${value}/edit`)} className="p-1 text-orange-600"><Edit size={17} /></button>}{canDelete && <button aria-label="Delete carrier" onClick={() => setDeleteId(value)} className="p-1 text-red-600"><Trash2 size={17} /></button>}</div> },
  ];
  return <div className="space-y-6">
    <PageHeader title="Carrier List" actions={canCreate ? <Button onClick={() => navigate('/contacts/carriers/create')} className="flex items-center gap-2"><Plus size={18} />Create Carrier</Button> : undefined} />
    {isError && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Carrier API is currently unavailable on the backend. The page and routes are ready, but `/api/v1/carriers` returns HTTP 500.</div>}
    <DataTable columns={columns} data={data?.data?.content || []} isLoading={isLoading} totalPages={data?.data?.totalPages || 1} currentPage={page} onPageChange={handlePageChange} searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search carriers..." />
    <ConfirmDialog isOpen={deleteId !== null} title="Delete Carrier" message="Are you sure you want to delete this carrier?" onConfirm={() => deleteId !== null && deletion.mutate(deleteId)} onCancel={() => setDeleteId(null)} isLoading={deletion.isPending} confirmText="Delete" variant="danger" />
  </div>;
};
