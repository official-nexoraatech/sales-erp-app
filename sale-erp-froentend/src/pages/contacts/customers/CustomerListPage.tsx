import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2, Edit, Eye, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Button } from '../../../components/ui/Button';
import { DataTable } from '../../../components/common/DataTable';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePagination } from '../../../hooks/usePagination';
import { CONSTANTS } from '../../../app/constants';
import { customerApi } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { formatCurrency } from '../../../utils/formatCurrency';

export const CustomerListPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const { page, handlePageChange } = usePagination();
  const debouncedSearch = useDebounce(searchTerm);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, debouncedSearch],
    queryFn: () =>
      customerApi.getAll({
        page,
        size: CONSTANTS.ITEMS_PER_PAGE,
        search: debouncedSearch,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => customerApi.delete(id),
    onSuccess: () => {
      toast.success('Customer deleted successfully');
      setDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to delete customer');
    },
  });

  const columns = [
    { key: 'customerCode', header: 'Customer Code' },
    { key: 'customerName', header: 'Customer Name' },
    { key: 'mobile', header: 'Mobile' },
    { key: 'balance', header: 'Balance', render: (value: number) => formatCurrency(value || 0) },
    {
      key: 'id',
      header: 'Actions',
      render: (value: number) => (
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/contacts/customers/${value}`)}
            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
          >
            <Eye size={18} />
          </button>
          <button
            onClick={() =>
              navigate(`/contacts/customers/${value}/edit`)
            }
            className="p-1 text-orange-600 hover:bg-orange-50 rounded"
          >
            <Edit size={18} />
          </button>
          <button
            onClick={() => setDeleteId(value)}
            className="p-1 text-red-600 hover:bg-red-50 rounded"
          >
            <Trash2 size={18} />
          </button>
        </div>
      ),
    },
  ];

  const pageData = data?.data?.content || [];
  const totalPages = data?.data?.totalPages || 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Manage your customers and their information"
        actions={
          <Button
            onClick={() => navigate('/contacts/customers/create')}
            className="flex items-center gap-2"
          >
            <Plus size={18} />
            New Customer
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={pageData}
        isLoading={isLoading}
        totalPages={totalPages}
        currentPage={page}
        onPageChange={handlePageChange}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search customers..."
      />

      <ConfirmDialog
        isOpen={deleteId !== null}
        title="Delete Customer"
        message="Are you sure you want to delete this customer? This action cannot be undone."
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        isLoading={deleteMutation.isPending}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
};
