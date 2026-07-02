import React, { useState } from 'react';
import { Edit, Eye, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, paymentInApi } from '../../../api/endpoints';
import type { PaymentListItem } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { useConfirmation } from '../../../hooks/useConfirmation';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';
import { downloadCsv, downloadExcel, printTable } from '../../../utils/tableExport';
import { PERMISSIONS } from '../../../auth/permissions';
import { TableExportButtons } from '../../../components/common/TableExportButtons';

const exportColumns = ['Date', 'Reference No.', 'Invoice No.', 'Customer', 'Paid', 'Created by', 'Created at'];

export const PaymentInListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.PAYMENT_IN_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.PAYMENT_IN_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.PAYMENT_IN_DELETE);
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [customerId, setCustomerId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

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
    if (extension === 'csv') downloadCsv(exportColumns, exportRows(), 'payment-in');
    else downloadExcel(exportColumns, exportRows(), 'payment-in', 'Payment In');
  };
  const printPdf = () => {
    if (!printTable(exportColumns, exportRows(), 'Payment In')) {
      toast.error('Please allow popups to print');
    }
  };

  const deletePayment = useMutation({
    mutationFn: paymentInApi.delete,
    onSuccess: () => {
      toast.success('Payment deleted');
      queryClient.invalidateQueries({ queryKey: ['payment-in'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete payment'),
  });

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home › Sale › Payment In</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Payment In</h1>
          {canCreate && <Button onClick={() => navigate('/sales/payment-in/create')} className="min-w-[150px]">Add Payment</Button>}
        </div>

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
          <TableExportButtons onCopy={copy} onDownloadExcel={() => download('xls')} onDownloadCsv={() => download('csv')} onPrint={printPdf} />
          <label className="flex items-center gap-2 text-sm">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded border px-3 py-2" /></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {payments.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{exportColumns.concat('Action').map((heading) => <th key={heading} className="border-b p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>
              {rows.length ? rows.map((payment: PaymentListItem) => <tr key={payment.paymentId} className="border-b even:bg-gray-50">
                <td className="p-3">{formatDate(payment.paymentDate)}</td><td className="p-3">{payment.paymentNo || 'N/A'}</td><td className="p-3">{payment.paymentNo || 'N/A'}</td><td className="p-3">{payment.customerName || payment.partyName || 'N/A'}</td><td className="p-3 font-semibold">{formatCurrency(payment.amount)}</td><td className="p-3">{user?.userName || 'N/A'}</td><td className="p-3">{formatDate(payment.paymentDate)}</td><td className="p-3">
                  <div className="flex items-center gap-2">
                    <button title="View payment" onClick={() => navigate(`/sales/payment-in/${payment.paymentId}`)} className="text-blue-600"><Eye size={17} /></button>
                    {canUpdate && <button title="Edit payment" onClick={() => navigate(`/sales/payment-in/${payment.paymentId}/edit`)} className="text-orange-600"><Edit size={17} /></button>}
                    {canDelete && <button title="Delete payment" onClick={async () => { if (await confirmAction({ title: 'Delete Payment', message: 'Delete this payment? This cannot be undone.', confirmText: 'Delete', variant: 'danger' })) deletePayment.mutate(payment.paymentId); }} className="text-red-600"><Trash2 size={17} /></button>}
                  </div>
                </td>
              </tr>) : <tr><td colSpan={8} className="bg-gray-50 p-5 text-center text-gray-700">No data available in table</td></tr>}
            </tbody>
          </table>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {payments.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={payments.data?.data?.totalPages || 1} onPageChange={handlePageChange} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
