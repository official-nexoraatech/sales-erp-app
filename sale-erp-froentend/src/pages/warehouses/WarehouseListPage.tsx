import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { warehouseApi } from '../../api/endpoints';
import type { Warehouse } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { useConfirmation } from '../../hooks/useConfirmation';
import { usePagination } from '../../hooks/usePagination';
import { formatCurrency } from '../../utils/formatCurrency';
import { formatDate } from '../../utils/formatDate';
import { PERMISSIONS } from '../../auth/permissions';

const exportColumns = ['Warehouse', 'Items', 'Available Stock', 'Worth Cost', 'Worth Sale', 'Worth Profit', 'Created by', 'Created at'];
const getNumber = (warehouse: Warehouse, keys: string[], fallback = 0) => {
  const record = warehouse as any;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
};

export const WarehouseListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.WAREHOUSE_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.WAREHOUSE_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.WAREHOUSE_DELETE);
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const warehouses = useQuery({ queryKey: ['warehouses', search], queryFn: () => warehouseApi.getAll(search) });
  const remove = useMutation({
    mutationFn: warehouseApi.delete,
    onSuccess: () => {
      toast.success('Warehouse deleted');
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete warehouse'),
  });
  const allRows: Warehouse[] = Array.isArray(warehouses.data?.data) ? warehouses.data?.data || [] : [];
  const rows = allRows.slice(page * pageSize, page * pageSize + pageSize);
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const allSelected = rows.length > 0 && rows.every((warehouse) => selectedIds.includes(warehouse.id));
  const exportRows = () => allRows.map((warehouse) => {
    const cost = getNumber(warehouse, ['worthCost', 'costWorth', 'stockValueCost']);
    const sale = getNumber(warehouse, ['worthSale', 'saleWorth', 'stockValueSale']);
    const profit = getNumber(warehouse, ['worthProfit', 'profitWorth'], sale - cost);
    return [warehouse.name, getNumber(warehouse, ['totalItems', 'itemCount']), getNumber(warehouse, ['availableStock', 'availableQty', 'quantity']), cost, sale, profit, warehouse.createdBy || user?.userName || 'admin', warehouse.createdAt || ''];
  });
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Warehouses copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `warehouses.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Warehouse List</title></head><body><h2>Warehouse List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one warehouse');
    const confirmed = await confirmAction({ title: 'Delete Warehouses', message: 'Delete selected warehouses?', confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Settings &gt; Warehouses</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Warehouse List</h1>
          {canCreate && <Button onClick={() => navigate('/warehouses/create')} className="min-w-[180px]">Create Warehouse</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex">{canDelete && <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>}<button onClick={copy} className={`h-10 border px-3 text-sm ${canDelete ? 'border-l-0' : 'rounded-l'}`}>Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {warehouses.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50"><tr>{canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((warehouse) => warehouse.id))} /></th>}{exportColumns.concat('Action').map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
              <tbody>
                {rows.length ? rows.map((warehouse) => {
                  const cost = getNumber(warehouse, ['worthCost', 'costWorth', 'stockValueCost']);
                  const sale = getNumber(warehouse, ['worthSale', 'saleWorth', 'stockValueSale']);
                  const profit = getNumber(warehouse, ['worthProfit', 'profitWorth'], sale - cost);
                  return (
                    <tr key={warehouse.id} className="border-b even:bg-gray-50">
                      {canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(warehouse.id)} onChange={() => setSelectedIds((current) => current.includes(warehouse.id) ? current.filter((id) => id !== warehouse.id) : [...current, warehouse.id])} /></td>}
                      <td className="border p-3 font-semibold">{warehouse.name}</td>
                      <td className="border p-3">{getNumber(warehouse, ['totalItems', 'itemCount'])}</td>
                      <td className="border p-3">{getNumber(warehouse, ['availableStock', 'availableQty', 'quantity']).toFixed(2)}</td>
                      <td className="border p-3">{formatCurrency(cost)}</td>
                      <td className="border p-3">{formatCurrency(sale)}</td>
                      <td className="border p-3">{formatCurrency(profit)}</td>
                      <td className="border p-3">{warehouse.createdBy || user?.userName || 'admin'}</td>
                      <td className="border p-3">{warehouse.createdAt ? formatDate(warehouse.createdAt) : ''}</td>
                      <td className="border p-3"><div className="flex gap-2"><button title="View warehouse" onClick={() => navigate(`/warehouses/${warehouse.id}`)} className="text-blue-600"><Eye size={16} /></button>{canUpdate && <button title="Edit warehouse" onClick={() => navigate(`/warehouses/${warehouse.id}/edit`, { state: warehouse })} className="text-orange-600"><Edit size={16} /></button>}{canDelete && <button title="Delete warehouse" onClick={async () => { if (await confirmAction({ title: 'Delete Warehouse', message: 'Delete this warehouse?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(warehouse.id); }} className="text-red-600"><Trash2 size={16} /></button>}</div></td>
                    </tr>
                  );
                }) : <tr><td colSpan={10} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {allRows.length} entries</span><Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} /></div>
      </div>
      {confirmationDialog}
    </div>
  );
};
