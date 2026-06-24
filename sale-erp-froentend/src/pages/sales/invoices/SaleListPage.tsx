import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Edit, Eye, FileText, Plus } from 'lucide-react';
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

const exportColumns = ['Sale Code', 'Date', 'Customer', 'Total', 'Balance', 'Status'];

export const SaleListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debounced = useDebounce(search);

  const customers = useQuery({ queryKey: ['sale-customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }) });
  const sales = useQuery({
    queryKey: ['sales', page, pageSize, debounced, fromDate, toDate],
    queryFn: () => salesApi.getAll({ page, size: pageSize, search: debounced, fromDate: fromDate || undefined, toDate: toDate || undefined }),
  });
  const cancel = useMutation({
    mutationFn: salesApi.cancel,
    onSuccess: () => { toast.success('Selected sale cancelled'); queryClient.invalidateQueries({ queryKey: ['sales'] }); },
    onError: (error: any) => toast.error(error?.message || 'Failed to cancel sale'),
  });

  const rows = (sales.data?.data?.content || []).filter((sale) =>
    !customerId || customers.data?.data?.content.find((customer) => customer.id === customerId)?.customerName === sale.customerName
  );
  const allSelected = rows.length > 0 && rows.every((sale) => selectedIds.includes(sale.saleId));

  const invoice = async (id: number) => {
    try {
      const response = await salesApi.getInvoice(id);
      toast.success(`Invoice ${response.data.invoiceNo} · ${response.data.customerName} · ${formatCurrency(response.data.grandTotal)}`);
    } catch (error: any) { toast.error(error?.message || 'Failed to load invoice'); }
  };
  const exportRows = () => rows.map((sale) => [sale.invoiceNo, sale.invoiceDate, sale.customerName, sale.grandTotal, sale.dueAmount, sale.dueAmount <= 0 ? 'PAID' : 'DUE']);
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `sales.${extension}`; link.click(); URL.revokeObjectURL(url);
  };
  const copy = async () => { await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n')); toast.success('Sales copied'); };
  const printPdf = () => {
    const popup = window.open('', '_blank'); if (!popup) return;
    popup.document.write(`<html><head><title>Sales</title></head><body><h2>Sale List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const cancelSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one sale');
    const confirmed = await confirmAction({ title: 'Cancel Sales', message: 'Cancel selected sales?', confirmText: 'Cancel', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await cancel.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home › Invoices › Sale List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Sale List</h1>
          <Button onClick={() => navigate('/sales/invoices/create')} className="flex items-center gap-2"><Plus size={18} />Create Sale</Button>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b p-5 md:grid-cols-2">
          <label className="text-sm text-gray-600">Customer
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={customerId} onChange={(event) => setCustomerId(Number(event.target.value))}><option value={0}>Select Customer</option>{customers.data?.data?.content.map((customer) => <option key={customer.id} value={customer.id}>{customer.customerName}</option>)}</select>
          </label>
          <label className="text-sm text-gray-600">User
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Choose one thing</option>{user?.userName && <option value={user.userName}>{user.userName}</option>}</select>
          </label>
          <label className="text-sm text-gray-600">From Date
            <input type="date" className="mt-1 w-full rounded border px-3 py-2.5" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(0); }} />
          </label>
          <label className="text-sm text-gray-600">To Date
            <input type="date" className="mt-1 w-full rounded border px-3 py-2.5" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(0); }} />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <label className="flex items-center gap-2 text-sm">Show
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="rounded border px-2 py-2"><option>10</option><option>20</option><option>50</option><option>100</option></select> entries
          </label>
          <div className="flex flex-wrap items-center gap-0">
            <button onClick={cancelSelected} className="rounded-l border border-red-300 px-3 py-2 text-sm text-red-500">Delete</button>
            <button onClick={copy} className="border-y border-r px-3 py-2 text-sm">Copy</button>
            <button onClick={() => download('xls')} className="border-y border-r px-3 py-2 text-sm">Excel</button>
            <button onClick={() => download('csv')} className="border-y border-r px-3 py-2 text-sm">CSV</button>
            <button onClick={printPdf} className="rounded-r border-y border-r px-3 py-2 text-sm">PDF</button>
          </div>
          <label className="flex items-center gap-2 text-sm">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="rounded border px-3 py-2" /></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {sales.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className="p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((sale) => sale.saleId))} /></th>{['Sale Code','Date','Customer','Total','Balance','Status','Created by','Created at','Action'].map((heading) => <th key={heading} className="border-b p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>{rows.map((sale: SaleListItem) => <tr key={sale.saleId} className="border-b even:bg-gray-50"><td className="p-3"><input type="checkbox" checked={selectedIds.includes(sale.saleId)} onChange={() => setSelectedIds((current) => current.includes(sale.saleId) ? current.filter((id) => id !== sale.saleId) : [...current, sale.saleId])} /></td><td className="p-3 font-semibold">{sale.invoiceNo}</td><td className="p-3">{formatDate(sale.invoiceDate)}</td><td className="p-3">{sale.customerName}</td><td className="p-3 font-semibold text-green-600">{formatCurrency(sale.grandTotal)}</td><td className="p-3">{formatCurrency(sale.dueAmount)}</td><td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${sale.dueAmount <= 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{sale.dueAmount <= 0 ? 'PAID' : 'DUE'}</span></td><td className="p-3">{user?.userName || 'N/A'}</td><td className="p-3">{formatDate(sale.invoiceDate)}</td><td className="p-3"><div className="flex gap-1"><button onClick={() => navigate(`/sales/invoices/${sale.saleId}`)} className="text-blue-600"><Eye size={17} /></button><button onClick={() => navigate(`/sales/invoices/${sale.saleId}/edit`)} className="text-orange-600"><Edit size={17} /></button><button onClick={() => invoice(sale.saleId)} className="text-indigo-600"><FileText size={17} /></button><button onClick={async () => { if (await confirmAction({ title: 'Cancel Sale', message: 'Cancel this sale?', confirmText: 'Cancel', variant: 'danger' })) cancel.mutate(sale.saleId); }} className="text-red-600"><Ban size={17} /></button></div></td></tr>)}</tbody>
          </table>}
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
