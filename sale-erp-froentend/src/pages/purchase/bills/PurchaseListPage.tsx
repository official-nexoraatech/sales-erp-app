import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Edit, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { purchaseApi, supplierApi } from '../../../api/endpoints';
import type { PurchaseListItem } from '../../../api/endpoints';
import { queryClient } from '../../../app/queryClient';
import { TableExportButtons } from '../../../components/common/TableExportButtons';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { Pagination } from '../../../components/ui/Pagination';
import { useAuth } from '../../../hooks/useAuth';
import { useConfirmation } from '../../../hooks/useConfirmation';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePagination } from '../../../hooks/usePagination';
import { formatCurrency } from '../../../utils/formatCurrency';
import { formatDate } from '../../../utils/formatDate';
import { downloadCsv, downloadExcel, printTable } from '../../../utils/tableExport';
import { PERMISSIONS } from '../../../auth/permissions';

const exportColumns = ['Purchase Code', 'Date', 'Days', 'Supplier', 'Total', 'Balance', 'Status'];
const daysSince = (date: string) => Math.max(0, Math.ceil((Date.now() - new Date(date).getTime()) / 86400000));
const purchaseCode = (purchase: PurchaseListItem) => purchase.purchaseNo || purchase.purchaseCode || `PB/${purchase.purchaseId}`;

interface Props { mode?: 'bill' | 'order' }

export const PurchaseListPage: React.FC<Props> = ({ mode = 'bill' }) => {
  const isOrder = mode === 'order';
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.PURCHASE_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.PURCHASE_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.PURCHASE_DELETE);
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [supplierId, setSupplierId] = useState(0);
  const [selectedUser, setSelectedUser] = useState(user?.userName || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const suppliers = useQuery({ queryKey: ['purchase-suppliers'], queryFn: () => supplierApi.getAll({ page: 0, size: 100, search: '' }) });
  const purchases = useQuery({
    queryKey: ['purchases', page, pageSize, debouncedSearch, fromDate, toDate],
    queryFn: () => purchaseApi.getAll({ page, size: pageSize, search: debouncedSearch, fromDate: fromDate || undefined, toDate: toDate || undefined }),
  });

  const cancel = useMutation({
    mutationFn: purchaseApi.cancel,
    onSuccess: () => {
      toast.success('Purchase cancelled');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to cancel purchase'),
  });

  const deletePurchase = useMutation({
    mutationFn: purchaseApi.delete,
    onSuccess: () => {
      toast.success(isOrder ? 'Purchase order deleted' : 'Purchase deleted');
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete purchase'),
  });

  const rows = (purchases.data?.data?.content || []).filter((purchase) => {
    if (!supplierId) return true;
    const supplier = suppliers.data?.data?.content.find((entry) => entry.id === supplierId);
    return supplier?.supplierName === purchase.supplierName;
  });
  const allSelected = rows.length > 0 && rows.every((purchase) => selectedIds.includes(purchase.purchaseId));

  const exportRows = () => rows.map((purchase) => [
    isOrder ? purchaseCode(purchase).replace('PB/', 'PO/') : purchaseCode(purchase),
    purchase.purchaseDate,
    daysSince(purchase.purchaseDate),
    purchase.supplierName,
    purchase.grandTotal,
    purchase.dueAmount || 0,
    purchase.status || ((purchase.dueAmount || 0) <= 0 ? 'PAID' : 'DUE'),
  ]);

  const download = (extension: 'csv' | 'xls') => {
    const filename = isOrder ? 'purchase-orders' : 'purchases';
    if (extension === 'csv') downloadCsv(exportColumns, exportRows(), filename);
    else downloadExcel(exportColumns, exportRows(), filename, isOrder ? 'Purchase Orders' : 'Purchases');
  };

  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Purchases copied');
  };

  const printPdf = () => {
    if (!printTable(exportColumns, exportRows(), isOrder ? 'Purchase Order List' : 'Purchase List')) {
      toast.error('Please allow popups to print');
    }
  };

  const cancelSelected = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one purchase');
      return;
    }
    const confirmed = await confirmAction({
      title: isOrder ? 'Cancel Purchase Orders' : 'Cancel Purchases',
      message: isOrder ? 'Cancel selected purchase orders?' : 'Cancel selected purchases?',
      confirmText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    for (const id of selectedIds) await cancel.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; {isOrder ? 'Purchase Order' : 'Purchase Bills'} &gt; {isOrder ? 'Purchase Order List' : 'Purchase List'}</div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">{isOrder ? 'Purchase Order List' : 'Purchase List'}</h1>
          {canCreate && <Button onClick={() => navigate(isOrder ? '/purchase/orders/create' : '/purchase/bills/create')} className="min-w-[190px]">{isOrder ? 'Create Purchase Order' : 'Create Purchase'}</Button>}
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-gray-600">Suppliers
            <select className="mt-1 h-10 w-full rounded border border-gray-300 px-3" value={supplierId} onChange={(event) => setSupplierId(Number(event.target.value))}>
              <option value={0}>Select Supplier</option>
              {suppliers.data?.data?.content.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplierName}</option>)}
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
          <TableExportButtons
            leadingButton={canDelete && <button onClick={cancelSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500 transition-all active:scale-95 active:bg-red-50">Delete</button>}
            onCopy={copy}
            onDownloadExcel={() => download('xls')}
            onDownloadCsv={() => download('csv')}
            onPrint={printPdf}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" />
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {purchases.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((purchase) => purchase.purchaseId))} /></th>}
                  {(isOrder ? ['Order ID', 'Date', 'Due Date', 'Supplier', 'Total', 'Balance', 'Status', 'Created by', 'Created at', 'Action'] : ['Purchase Code', 'Date', 'Days', 'Supplier', 'Total', 'Balance', 'Status', 'Created by', 'Created at', 'Action']).map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((purchase: PurchaseListItem) => (
                  <tr key={purchase.purchaseId} className="border-b even:bg-gray-50">
                    {canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(purchase.purchaseId)} onChange={() => setSelectedIds((current) => current.includes(purchase.purchaseId) ? current.filter((id) => id !== purchase.purchaseId) : [...current, purchase.purchaseId])} /></td>}
                    <td className="border p-3 font-semibold">{isOrder ? purchaseCode(purchase).replace('PB/', 'PO/') : purchaseCode(purchase)}</td>
                    <td className="border p-3">{formatDate(purchase.purchaseDate)}</td>
                    <td className="border p-3">{isOrder ? formatDate(purchase.purchaseDate) : daysSince(purchase.purchaseDate)}</td>
                    <td className="border p-3">{purchase.supplierName}</td>
                    <td className="border p-3 font-semibold text-green-600">{formatCurrency(purchase.grandTotal)}</td>
                    <td className="border p-3">{formatCurrency(purchase.dueAmount || 0)}</td>
                    <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${isOrder ? 'bg-amber-100 text-amber-700' : (purchase.dueAmount || 0) <= 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{isOrder ? 'PENDING' : purchase.status || ((purchase.dueAmount || 0) <= 0 ? 'PAID' : 'DUE')}</span></td>
                    <td className="border p-3">{user?.userName || 'admin'}</td>
                    <td className="border p-3">{formatDate(purchase.purchaseDate)}</td>
                    <td className="border p-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => navigate(isOrder ? `/purchase/orders/${purchase.purchaseId}` : `/purchase/bills/${purchase.purchaseId}`)} className="text-blue-600" title="View"><Eye size={17} /></button>
                        {canUpdate && <button onClick={() => navigate(isOrder ? `/purchase/orders/${purchase.purchaseId}/edit` : `/purchase/bills/${purchase.purchaseId}/edit`)} className="text-orange-600" title="Edit"><Edit size={17} /></button>}
                        {canDelete && <button
                          onClick={async () => {
                            const confirmed = await confirmAction({
                              title: isOrder ? 'Cancel Purchase Order' : 'Cancel Purchase',
                              message: isOrder ? 'Cancel this purchase order?' : 'Cancel this purchase?',
                              confirmText: 'Cancel',
                              variant: 'danger',
                            });
                            if (confirmed) cancel.mutate(purchase.purchaseId);
                          }}
                          className="text-red-600"
                          title="Cancel"
                        >
                          <Ban size={17} />
                        </button>}
                        {canDelete && <button
                          onClick={async () => {
                            const confirmed = await confirmAction({
                              title: isOrder ? 'Delete Purchase Order' : 'Delete Purchase',
                              message: isOrder ? 'Delete this purchase order? This cannot be undone.' : 'Delete this purchase? This cannot be undone.',
                              confirmText: 'Delete',
                              variant: 'danger',
                            });
                            if (confirmed) deletePurchase.mutate(purchase.purchaseId);
                          }}
                          className="text-red-600"
                          title="Delete"
                        >
                          <Trash2 size={17} />
                        </button>}
                      </div>
                    </td>
                  </tr>
                )) : <tr><td colSpan={11} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {purchases.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={purchases.data?.data?.totalPages || 1} onPageChange={handlePageChange} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
