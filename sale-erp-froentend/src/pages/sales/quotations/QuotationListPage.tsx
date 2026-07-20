import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { customerApi, quotationApi } from '../../../api/endpoints';
import type { QuotationListItem } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { PERMISSIONS } from '../../../auth/permissions';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { useConfirmation } from '../../../hooks/useConfirmation';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';
import { TableExportButtons } from '../../../components/common/TableExportButtons';

const exportColumns = ['Quotation No', 'Date', 'Valid Until', 'Customer', 'Total', 'Status', 'Invoice'];
const tableColumns = ['Quotation ID', 'Date', 'Valid Until', 'Customer', 'Total', 'Status', 'Invoice', 'Created by', 'Created at', 'Action'];

const canConvertQuotation = (quotation: QuotationListItem) => {
  const status = quotation.status?.toUpperCase();
  return !quotation.convertedSaleId && !['CONVERTED', 'CANCELLED', 'REJECTED'].includes(status || '');
};

const canDeleteQuotation = (quotation: QuotationListItem) => !quotation.convertedSaleId && quotation.status?.toUpperCase() !== 'CONVERTED';

const formatOptionalDate = (value?: string) => value ? formatDate(value) : '-';

const statusClass = (status?: string) => {
  switch (status?.toUpperCase()) {
    case 'CONVERTED':
      return 'bg-green-100 text-green-700';
    case 'APPROVED':
      return 'bg-blue-100 text-blue-700';
    case 'REJECTED':
    case 'CANCELLED':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-amber-100 text-amber-700';
  }
};

export const QuotationListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const canCreate = hasPermission(PERMISSIONS.SALES_CREATE);
  const canDelete = hasPermission(PERMISSIONS.SALES_DELETE);
  const [pageSize, setPageSize] = useState(10);
  const [customerId, setCustomerId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [status, setStatus] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debounced = useDebounce(search);

  const customers = useQuery({
    queryKey: ['quotation-customers'],
    queryFn: () => customerApi.getAll({ page: 0, size: 100, search: '' }),
  });

  const quotations = useQuery({
    queryKey: ['quotations', page, pageSize, debounced, customerId, status, fromDate, toDate],
    queryFn: () => quotationApi.getAll({
      page,
      size: pageSize,
      search: debounced,
      customerId: customerId || undefined,
      status: status || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    }),
  });

  const convert = useMutation({
    mutationFn: (id: number) => quotationApi.convertToInvoice(id),
    onSuccess: async (response) => {
      toast.success(`Invoice ${response.data.invoiceNo} created from quotation`);
      await queryClient.invalidateQueries({ queryKey: ['quotations'] });
      await queryClient.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to convert quotation'),
  });

  const deleteQuotation = useMutation({
    mutationFn: quotationApi.delete,
    onSuccess: async () => {
      toast.success('Quotation deleted');
      await queryClient.invalidateQueries({ queryKey: ['quotations'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete quotation'),
  });

  const rows = quotations.data?.data?.content || [];
  const selectableRows = rows.filter(canDeleteQuotation);
  const allSelected = selectableRows.length > 0 && selectableRows.every((quotation) => selectedIds.includes(quotation.quotationId));
  const isLoading = quotations.isLoading || quotations.isFetching;

  const exportRows = () => rows.map((quotation) => [
    quotation.quotationNo,
    formatOptionalDate(quotation.quotationDate),
    formatOptionalDate(quotation.validUntil),
    quotation.customerName || '-',
    formatCurrency(quotation.grandTotal || 0),
    quotation.status || 'PENDING',
    quotation.convertedInvoiceNo || '-',
  ]);

  const hasExportRows = () => {
    if (rows.length) return true;
    toast.error('No quotation records to export');
    return false;
  };

  const download = (extension: 'csv' | 'xls') => {
    if (!hasExportRows()) return;
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator))
      .join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quotations.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    if (!hasExportRows()) return;
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Quotations copied');
  };

  const printPdf = () => {
    if (!hasExportRows()) return;
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Quotations</title></head><body><h2>Quotation List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };

  const convertQuotation = async (quotation: QuotationListItem) => {
    const confirmed = await confirmAction({
      title: 'Convert Quotation',
      message: `Create an invoice from quotation ${quotation.quotationNo}?`,
      confirmText: 'Convert',
      variant: 'info',
    });
    if (confirmed) convert.mutate(quotation.quotationId);
  };

  const deleteOne = async (quotation: QuotationListItem) => {
    const confirmed = await confirmAction({
      title: 'Delete Quotation',
      message: `Delete quotation ${quotation.quotationNo}?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (confirmed) deleteQuotation.mutate(quotation.quotationId);
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one quotation');
      return;
    }
    const confirmed = await confirmAction({
      title: 'Delete Quotations',
      message: 'Delete selected quotations?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    for (const id of selectedIds) {
      await deleteQuotation.mutateAsync(id);
    }
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Sale &gt; Quotation List</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Quotation List</h1>
          {canCreate && (
            <Button onClick={() => navigate('/sales/quotations/create')} className="flex min-w-44 items-center justify-center gap-2">
              <Plus size={18} />Create Quotation
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-b p-5 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm text-gray-600">Customer
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={customerId} onChange={(event) => { setCustomerId(Number(event.target.value)); setPage(0); }}>
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
          <label className="text-sm text-gray-600">Status
            <select className="mt-1 w-full rounded border px-3 py-2.5" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
              <option value="">All Status</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="CONVERTED">Converted</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
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
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="rounded border px-2 py-2">
              <option>10</option><option>20</option><option>50</option><option>100</option>
            </select> entries
          </label>
          <TableExportButtons
            onCopy={copy}
            onDownloadExcel={() => download('xls')}
            onDownloadCsv={() => download('csv')}
            onPrint={printPdf}
            leadingButton={canDelete && <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500 transition-all active:scale-95 active:bg-red-50">Delete</button>}
          />
          <label className="flex items-center gap-2 text-sm">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="rounded border px-3 py-2" /></label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {canDelete && <th className="p-3"><input type="checkbox" checked={allSelected} disabled={!selectableRows.length} onChange={() => setSelectedIds(allSelected ? [] : selectableRows.map((quotation) => quotation.quotationId))} /></th>}
                  {tableColumns.map((heading) => <th key={heading} className="border-b p-3 text-left">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((quotation) => {
                  const deletable = canDeleteQuotation(quotation);
                  const convertible = canCreate && canConvertQuotation(quotation);
                  return (
                    <tr key={quotation.quotationId} className="border-b even:bg-gray-50">
                      {canDelete && <td className="p-3"><input type="checkbox" disabled={!deletable} checked={selectedIds.includes(quotation.quotationId)} onChange={() => setSelectedIds((current) => current.includes(quotation.quotationId) ? current.filter((id) => id !== quotation.quotationId) : [...current, quotation.quotationId])} /></td>}
                      <td className="p-3 font-semibold">{quotation.quotationNo}</td>
                      <td className="p-3">{formatOptionalDate(quotation.quotationDate)}</td>
                      <td className="p-3">{formatOptionalDate(quotation.validUntil)}</td>
                      <td className="p-3">{quotation.customerName || '-'}</td>
                      <td className="p-3 font-semibold text-green-600">{formatCurrency(quotation.grandTotal || 0)}</td>
                      <td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(quotation.status)}`}>{quotation.status || 'PENDING'}</span></td>
                      <td className="p-3">{quotation.convertedInvoiceNo || '-'}</td>
                      <td className="p-3">{user?.userName || 'N/A'}</td>
                      <td className="p-3">{formatOptionalDate(quotation.quotationDate)}</td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          {quotation.convertedInvoiceNo && quotation.convertedSaleId && (
                            <button
                              type="button"
                              onClick={() => navigate(`/sales/invoices/${quotation.convertedSaleId}`)}
                              className="text-indigo-600 hover:text-indigo-800"
                              title={`View invoice ${quotation.convertedInvoiceNo}`}
                              aria-label="View invoice"
                            >
                              <FileText size={17} />
                            </button>
                          )}
                          {convertible && <button type="button" onClick={() => convertQuotation(quotation)} disabled={convert.isPending} className="text-green-600 disabled:opacity-50" title="Convert to invoice" aria-label="Convert to invoice"><CheckCircle2 size={17} /></button>}
                          {canDelete && deletable && <button type="button" onClick={() => deleteOne(quotation)} disabled={deleteQuotation.isPending} className="text-red-600 disabled:opacity-50" title="Delete quotation" aria-label="Delete quotation"><Trash2 size={17} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={tableColumns.length + (canDelete ? 1 : 0)} className="bg-gray-50 p-5 text-center text-sm text-gray-700">No data available in table</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {quotations.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={quotations.data?.data?.totalPages || 1} onPageChange={handlePageChange} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
