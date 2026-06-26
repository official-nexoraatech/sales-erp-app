import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { purchaseReturnApi, supplierApi } from '../../../api/endpoints';
import type { PurchaseReturnListItem } from '../../../api/endpoints';
import { PERMISSIONS } from '../../../auth/permissions';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';

const exportColumns = ['Return ID', 'Date', 'Supplier', 'Total', 'Balance', 'Created by', 'Created at'];
const returnCode = (entry: PurchaseReturnListItem) => entry.returnNo || `PR/${entry.returnId}`;

export const PurchaseReturnListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { page, setPage, handlePageChange } = usePagination();
  const canCreate = hasPermission(PERMISSIONS.PURCHASE_RETURN_CREATE);
  const [pageSize, setPageSize] = useState(10);
  const [supplierId, setSupplierId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  const suppliers = useQuery({ queryKey: ['purchase-return-suppliers'], queryFn: () => supplierApi.getAll({ page: 0, size: 100, search: '' }) });
  const returns = useQuery({ queryKey: ['purchase-returns', page, pageSize], queryFn: () => purchaseReturnApi.getAll({ page, size: pageSize }) });

  const rows = (returns.data?.data?.content || [])
    .filter((entry) => !supplierId || suppliers.data?.data?.content.find((supplier) => supplier.id === supplierId)?.supplierName === entry.supplierName)
    .filter((entry) => !search || JSON.stringify(entry).toLowerCase().includes(search.toLowerCase()))
    .filter((entry) => !fromDate || entry.returnDate >= fromDate)
    .filter((entry) => !toDate || entry.returnDate <= toDate);

  const exportRows = () => rows.map((entry) => [
    returnCode(entry),
    entry.returnDate,
    entry.supplierName,
    entry.totalAmount || entry.grandTotal || 0,
    entry.balance || 0,
    user?.userName || '',
    entry.returnDate,
  ]);
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Purchase returns copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `purchase-returns.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Purchase Returns</title></head><body><h2>Purchase Return/Dr.Note</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Purchase &gt; Purchase Return/Dr.Note</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Purchase Return/Dr.Note</h1>
          {canCreate && (
            <Button onClick={() => navigate('/purchase/returns/create')} className="min-w-[220px]">Purchase Return/Dr.Note</Button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-gray-600">Suppliers<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}><option value={0}>Select Supplier</option>{suppliers.data?.data?.content.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}</select></label>
          <label className="text-sm text-gray-600">User<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Choose one thing</option>{user?.userName && <option value={user.userName}>{user.userName}</option>}</select></label>
          <label className="text-sm text-gray-600">From Date<input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label className="text-sm text-gray-600">To Date<input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex flex-wrap items-center"><button onClick={copy} className="h-10 rounded-l border border-r px-3 text-sm">Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {returns.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{exportColumns.concat('Action').map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>{rows.length ? rows.map((entry: PurchaseReturnListItem) => <tr key={entry.returnId} className="border-b even:bg-gray-50"><td className="border p-3 font-semibold">{returnCode(entry)}</td><td className="border p-3">{formatDate(entry.returnDate)}</td><td className="border p-3">{entry.supplierName}</td><td className="border p-3 font-semibold text-green-600">{formatCurrency(entry.totalAmount || entry.grandTotal || 0)}</td><td className="border p-3">{formatCurrency(entry.balance || 0)}</td><td className="border p-3">{user?.userName || 'admin'}</td><td className="border p-3">{formatDate(entry.returnDate)}</td><td className="border p-3"><button onClick={() => navigate(`/purchase/returns/${entry.returnId}`)} className="text-blue-600"><Eye size={17} /></button></td></tr>) : <tr><td colSpan={8} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody>
          </table>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {returns.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={returns.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
    </div>
  );
};
