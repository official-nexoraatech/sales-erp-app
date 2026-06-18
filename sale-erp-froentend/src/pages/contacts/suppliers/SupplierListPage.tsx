import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supplierApi } from '../../../api/endpoints';
import { CONSTANTS } from '../../../app/constants';
import { queryClient } from '../../../app/queryClient';
import { DataTable } from '../../../components/common/DataTable';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';

export const SupplierListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { page, handlePageChange } = usePagination();
  const debouncedSearch = useDebounce(searchTerm);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, debouncedSearch],
    queryFn: () => supplierApi.getAll({ page, size: CONSTANTS.ITEMS_PER_PAGE, search: debouncedSearch }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => supplierApi.delete(id),
    onSuccess: () => {
      toast.success('Supplier deleted successfully');
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete supplier'),
  });

  const columns = [
    { key: 'supplierCode', header: 'Supplier Code' },
    { key: 'supplierName', header: 'Supplier Name' },
    { key: 'mobile', header: 'Mobile' },
    { key: 'balance', header: 'Balance', render: (value: number) => formatCurrency(value || 0) },
    {
      key: 'id',
      header: 'Actions',
      render: (value: number) => (
        <div className="flex gap-2">
          <button aria-label="View supplier" onClick={() => navigate(`/contacts/suppliers/${value}`)} className="rounded p-1 text-blue-600 hover:bg-blue-50"><Eye size={18} /></button>
          <button aria-label="Edit supplier" onClick={() => navigate(`/contacts/suppliers/${value}/edit`)} className="rounded p-1 text-orange-600 hover:bg-orange-50"><Edit size={18} /></button>
          <button aria-label="Delete supplier" onClick={() => setDeleteId(value)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 size={18} /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Manage your suppliers and their information"
        actions={<Button onClick={() => navigate('/contacts/suppliers/create')} className="flex items-center gap-2"><Plus size={18} />New Supplier</Button>}
      />
      <DataTable
        columns={columns}
        data={data?.data?.content || []}
        isLoading={isLoading}
        totalPages={data?.data?.totalPages || 1}
        currentPage={page}
        onPageChange={handlePageChange}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search suppliers..."
      />
      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete Supplier"
        message="Are you sure you want to delete this supplier? This action cannot be undone."
        onConfirm={() => deleteId !== null && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        isLoading={deleteMutation.isPending}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
};
