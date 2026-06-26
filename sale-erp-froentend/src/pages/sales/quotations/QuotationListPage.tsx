import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi } from '../../../api/endpoints';
import { PERMISSIONS } from '../../../auth/permissions';
import { Button } from '../../../components/ui/Button';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { usePagination } from '../../../hooks/usePagination';

const columns = ['Quotation ID', 'Date', 'Customer', 'Total', 'Status', 'Created by', 'Created at', 'Action'];

export const QuotationListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { page, handlePageChange } = usePagination();
  const canCreate = hasPermission(PERMISSIONS.SALES_CREATE);
  const canDelete = hasPermission(PERMISSIONS.SALES_DELETE);
  const [pageSize, setPageSize] = useState(10);
  const [customerId, setCustomerId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  const customers = useQuery({
    queryKey: ['quotation-customers'],
    queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }),
  });

  const exportEmpty = () => toast('No quotation records to export');

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home › Sale › Quotation List</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Quotation List</h1>
          {canCreate && (
            <Button onClick={() => navigate('/sales/quotations/create')} className="flex min-w-44 items-center justify-center gap-2">
              <Plus size={18} />Create Quotation
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-gray-600">Customer
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>
              <option value={0}>Select Customer</option>
              {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">User
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}>
              <option value="">Choose one thing</option>
              {user?.userName && <option value={user.userName}>{user.userName}</option>}
            </select>
          </label>
          <label className="text-sm text-gray-600">From Date
            <input type="date" className="mt-1 w-full rounded border px-3 py-2.5" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </label>
          <label className="text-sm text-gray-600">To Date
            <input type="date" className="mt-1 w-full rounded border px-3 py-2.5" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <label className="flex items-center gap-2 text-sm">Show
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded border px-2 py-2">
              <option>10</option><option>20</option><option>50</option><option>100</option>
            </select> entries
          </label>
          <div className="flex flex-wrap items-center gap-0">
            {canDelete && (
              <button onClick={exportEmpty} className="rounded-l border border-red-300 px-3 py-2 text-sm text-red-500">Delete</button>
            )}
            <button onClick={exportEmpty} className={`${canDelete ? 'border-y border-r' : 'rounded-l border'} px-3 py-2 text-sm`}>Copy</button>
            <button onClick={exportEmpty} className="border-y border-r px-3 py-2 text-sm">Excel</button>
            <button onClick={exportEmpty} className="border-y border-r px-3 py-2 text-sm">CSV</button>
            <button onClick={exportEmpty} className="rounded-r border-y border-r px-3 py-2 text-sm">PDF</button>
          </div>
          <label className="flex items-center gap-2 text-sm">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded border px-3 py-2" /></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                {canDelete && <th className="p-3"><input type="checkbox" disabled /></th>}
                {columns.map((heading) => <th key={heading} className="border-b p-3 text-left">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr><td colSpan={columns.length + (canDelete ? 1 : 0)} className="bg-gray-50 p-5 text-center text-sm text-gray-700">No data available in table</td></tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing 0 to 0 of 0 entries</span>
          <Pagination page={page} totalPages={1} onPageChange={handlePageChange} />
        </div>
      </div>
    </div>
  );
};
