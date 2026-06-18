import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, paymentInApi } from '../../../api/endpoints';
import type { PaymentListItem } from '../../../api/endpoints';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';

const exportColumns = ['Date', 'Reference No.', 'Invoice No.', 'Customer', 'Paid', 'Created by', 'Created at'];

export const PaymentInListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [customerId, setCustomerId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const customers = useQuery({ queryKey: ['payment-in-customers'], queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }) });
  const payments = useQuery({
    queryKey: ['payment-in', page, pageSize],
    queryFn: () => paymentInApi.getAll({ page, size: pageSize }),
  });

  const rows = (payments.data?.data?.content || [])
    .filter((payment) => !customerId || customers.data?.data?.content.find((customer) => customer.id === customerId)?.customerName === payment.customerName)
    .filter((payment) => !search || JSON.stringify(payment).toLowerCase().includes(search.toLowerCase()))
    .filter((payment) => !fromDate || payment.paymentDate >= fromDate)
    .filter((payment) => !toDate || payment.paymentDate <= toDate);
  const allSelected = rows.length > 0 && rows.every((payment) => selectedIds.includes(payment.paymentId));

  const exportRows = () => rows.map((payment) => [
    payment.paymentDate,
    payment.paymentNo || '',
    payment.paymentNo || '',
    payment.customerName || payment.partyName || '',
    payment.amount,
    user?.userName || '',
    payment.paymentDate,
  ]);
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Payment records copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payment-in.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Payment In</title></head><body><h2>Payment In</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home › Sale › Payment In</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="border-b px-5 py-4"><h1 className="text-xl font-semibold uppercase text-gray-900">Payment In</h1></div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-gray-600">Customers
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
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="rounded border px-2 py-2">
              <option>10</option><option>20</option><option>50</option><option>100</option>
            </select> entries
          </label>
          <div className="flex flex-wrap items-center gap-0">
            <button onClick={() => toast('Delete API is not available for Payment In')} className="rounded-l border border-red-300 px-3 py-2 text-sm text-red-500">Delete</button>
            <button onClick={copy} className="border-y border-r px-3 py-2 text-sm">Copy</button>
            <button onClick={() => download('xls')} className="border-y border-r px-3 py-2 text-sm">Excel</button>
            <button onClick={() => download('csv')} className="border-y border-r px-3 py-2 text-sm">CSV</button>
            <button onClick={printPdf} className="rounded-r border-y border-r px-3 py-2 text-sm">PDF</button>
          </div>
          <label className="flex items-center gap-2 text-sm">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded border px-3 py-2" /></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {payments.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className="p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((payment) => payment.paymentId))} /></th>{exportColumns.concat('Action').map((heading) => <th key={heading} className="border-b p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>
              {rows.length ? rows.map((payment: PaymentListItem) => <tr key={payment.paymentId} className="border-b even:bg-gray-50">
                <td className="p-3"><input type="checkbox" checked={selectedIds.includes(payment.paymentId)} onChange={() => setSelectedIds((current) => current.includes(payment.paymentId) ? current.filter((id) => id !== payment.paymentId) : [...current, payment.paymentId])} /></td>
                <td className="p-3">{formatDate(payment.paymentDate)}</td><td className="p-3">{payment.paymentNo || 'N/A'}</td><td className="p-3">{payment.paymentNo || 'N/A'}</td><td className="p-3">{payment.customerName || payment.partyName || 'N/A'}</td><td className="p-3 font-semibold">{formatCurrency(payment.amount)}</td><td className="p-3">{user?.userName || 'N/A'}</td><td className="p-3">{formatDate(payment.paymentDate)}</td><td className="p-3"><button onClick={() => navigate(`/sales/payment-in/${payment.paymentId}`)} className="text-blue-600"><Eye size={17} /></button></td>
              </tr>) : <tr><td colSpan={9} className="bg-gray-50 p-5 text-center text-gray-700">No data available in table</td></tr>}
            </tbody>
          </table>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {payments.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={payments.data?.data?.totalPages || 1} onPageChange={handlePageChange} />
        </div>
      </div>
    </div>
  );
};
