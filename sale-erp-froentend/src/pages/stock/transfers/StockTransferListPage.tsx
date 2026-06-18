import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { stockTransferApi } from '../../../api/endpoints';
import type { StockTransferListItem } from '../../../api/endpoints';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { usePagination } from '../../../hooks/usePagination';
import { formatDate } from '../../../utils/formatDate';

const exportColumns = ['Transfer Code', 'Date', 'Created by', 'Created at'];
const transferCode = (entry: StockTransferListItem) => entry.transferNo || entry.transferCode || `ST/${entry.transferId}`;

export const StockTransferListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const transfers = useQuery({ queryKey: ['stock-transfers', page, pageSize], queryFn: () => stockTransferApi.getAll({ page, size: pageSize }) });
  const rows = (transfers.data?.data?.content || [])
    .filter((entry) => !search || JSON.stringify(entry).toLowerCase().includes(search.toLowerCase()))
    .filter((entry) => !fromDate || entry.transferDate >= fromDate)
    .filter((entry) => !toDate || entry.transferDate <= toDate);
  const allSelected = rows.length > 0 && rows.every((entry) => selectedIds.includes(entry.transferId));

  const exportRows = () => rows.map((entry) => [transferCode(entry), entry.transferDate, entry.createdBy || user?.userName || 'admin', entry.createdAt || entry.transferDate]);
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Stock transfers copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stock-transfers.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Stock Transfer</title></head><body><h2>Stock Transfer List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Stock &gt; Stock Transfer List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4"><h1 className="text-xl font-semibold uppercase text-gray-900">Stock Transfer List</h1><Button onClick={() => navigate('/stock/transfers/create')} className="min-w-[150px]">New Transfer</Button></div>
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
          <label className="text-sm text-gray-600">From Date<input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label className="text-sm text-gray-600">To Date<input type="date" className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          <label className="text-sm text-gray-600">User<select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Choose one thing</option>{user?.userName && <option value={user.userName}>{user.userName}</option>}</select></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex flex-wrap items-center"><button onClick={() => toast('Delete API is not available for Stock Transfer')} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button><button onClick={copy} className="h-10 border-y border-r px-3 text-sm">Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">{transfers.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((entry) => entry.transferId))} /></th>{exportColumns.concat('Action').map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead><tbody>{rows.length ? rows.map((entry: StockTransferListItem) => <tr key={entry.transferId} className="border-b even:bg-gray-50"><td className="border p-3"><input type="checkbox" checked={selectedIds.includes(entry.transferId)} onChange={() => setSelectedIds((current) => current.includes(entry.transferId) ? current.filter((id) => id !== entry.transferId) : [...current, entry.transferId])} /></td><td className="border p-3 font-semibold">{transferCode(entry)}</td><td className="border p-3">{formatDate(entry.transferDate)}</td><td className="border p-3">{entry.createdBy || user?.userName || 'admin'}</td><td className="border p-3">{formatDate(entry.createdAt || entry.transferDate)}</td><td className="border p-3"><button onClick={() => navigate(`/stock/transfers/${entry.transferId}`)} className="text-blue-600"><Eye size={17} /></button></td></tr>) : <tr><td colSpan={6} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody></table>}</div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {transfers.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={transfers.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
    </div>
  );
};
