import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Edit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, salesApi } from '../../../api/endpoints';
import type { SaleListItem } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { useConfirmation } from '../../../hooks/useConfirmation';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';
import { PERMISSIONS } from '../../../auth/permissions';

const exportColumns = ['Order ID', 'Date', 'Due Date', 'Customer', 'Total', 'Balance', 'Status'];

export const SaleOrderListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.SALES_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.SALES_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.SALES_DELETE);
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const customers = useQuery({
    queryKey: ['sale-order-customers'],
    queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }),
  });

  const sales = useQuery({
    queryKey: ['sale-orders', page, pageSize, debouncedSearch, fromDate, toDate],
    queryFn: () => salesApi.getAll({
      page,
      size: pageSize,
      search: debouncedSearch,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
  });

  const cancel = useMutation({
    mutationFn: salesApi.cancel,
    onSuccess: () => {
      toast.success('Sale order cancelled');
      queryClient.invalidateQueries({ queryKey: ['sale-orders'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to cancel sale order'),
  });

  const rows = (sales.data?.data?.content || []).filter((sale) => {
    if (!customerId) return true;
    const customer = customers.data?.data?.content.find((entry) => entry.id === customerId);
    return customer?.customerName === sale.customerName;
  });
  const allSelected = rows.length > 0 && rows.every((sale) => selectedIds.includes(sale.saleId));

  const exportRows = () => rows.map((sale) => [
    sale.invoiceNo,
    sale.invoiceDate,
    sale.invoiceDate,
    sale.customerName,
    sale.grandTotal,
    sale.dueAmount,
    sale.dueAmount <= 0 ? 'PAID' : 'DUE',
  ]);

  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator))
      .join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sale-orders.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Sale orders copied');
  };

  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Sale Orders</title></head><body><h2>Sale Order List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  const cancelSelected = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one sale order');
      return;
    }
    const confirmed = await confirmAction({ title: 'Cancel Sale Orders', message: 'Cancel selected sale orders?', confirmText: 'Cancel', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await cancel.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Sale Order &gt; Sale Order List</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Sale Order List</h1>
          {canCreate && <Button onClick={() => navigate('/sales/orders/create')} className="min-w-[175px]">Create Sale Order</Button>}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-gray-600">Customer
            <select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}>
              <option value={0}>Select Customer</option>
              {customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">User
            <select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}>
              <option value="">Choose one thing</option>
              {user?.userName && <option value={user.userName}>{user.userName}</option>}
            </select>
          </label>
          <label className="text-sm text-gray-600">From Date
            <input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} />
          </label>
          <label className="text-sm text-gray-600">To Date
            <input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2">
              <option>10</option><option>20</option><option>50</option><option>100</option>
            </select>
            entries
          </label>
          <div className="flex flex-wrap items-center">
            {canDelete && <button onClick={cancelSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>}
            <button onClick={copy} className={`h-10 border px-3 text-sm ${canDelete ? 'border-l-0' : 'rounded-l'}`}>Copy</button>
            <button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button>
            <button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button>
            <button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" />
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {sales.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((sale) => sale.saleId))} /></th>}
                  {['Order ID', 'Date', 'Due Date', 'Customer', 'Total', 'Balance', 'Status', 'Created by', 'Created at', 'Action'].map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((sale: SaleListItem) => (
                  <tr key={sale.saleId} className="border-b even:bg-gray-50">
                    {canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(sale.saleId)} onChange={() => setSelectedIds((current) => current.includes(sale.saleId) ? current.filter((id) => id !== sale.saleId) : [...current, sale.saleId])} /></td>}
                    <td className="border p-3 font-semibold">{sale.invoiceNo}</td>
                    <td className="border p-3">{formatDate(sale.invoiceDate)}</td>
                    <td className="border p-3">{formatDate(sale.invoiceDate)}</td>
                    <td className="border p-3">{sale.customerName}</td>
                    <td className="border p-3 font-semibold text-green-600">{formatCurrency(sale.grandTotal)}</td>
                    <td className="border p-3">{formatCurrency(sale.dueAmount)}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${sale.dueAmount <= 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{sale.dueAmount <= 0 ? 'PAID' : 'DUE'}</span></td>
                    <td className="border p-3">{user?.userName || 'admin'}</td>
                    <td className="border p-3">{formatDate(sale.invoiceDate)}</td>
                    <td className="border p-3">
                      <div className="flex items-center gap-2">
                        {canUpdate && <button onClick={() => navigate(`/sales/orders/${sale.saleId}/edit`)} className="text-orange-600" title="Edit"><Edit size={17} /></button>}
                        {canDelete && <button onClick={async () => { if (await confirmAction({ title: 'Cancel Sale Order', message: 'Cancel this sale order?', confirmText: 'Cancel', variant: 'danger' })) cancel.mutate(sale.saleId); }} className="text-red-600" title="Cancel"><Ban size={17} /></button>}
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={11} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {sales.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={sales.data?.data?.totalPages || 1} onPageChange={handlePageChange} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
