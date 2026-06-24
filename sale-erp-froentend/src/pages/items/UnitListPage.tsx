import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { unitApi } from '../../api/endpoints';
import type { Unit } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { useConfirmation } from '../../hooks/useConfirmation';
import { useDebounce } from '../../hooks/useDebounce';
import { usePagination } from '../../hooks/usePagination';
import { formatDate } from '../../utils/formatDate';
import { PERMISSIONS } from '../../auth/permissions';

const exportColumns = ['Name', 'Short Name', 'Created by', 'Created at'];

export const UnitListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const canCreate = hasPermission(PERMISSIONS.UNIT_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.UNIT_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.UNIT_DELETE);
  const showActions = canUpdate || canDelete;
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const units = useQuery({ queryKey: ['units', page, pageSize, debouncedSearch], queryFn: () => unitApi.getAll({ page, size: pageSize, search: debouncedSearch }) });
  const remove = useMutation({
    mutationFn: unitApi.delete,
    onSuccess: () => {
      toast.success('Unit deleted');
      queryClient.invalidateQueries({ queryKey: ['units'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete unit'),
  });

  const rows = units.data?.data?.content || [];
  const allSelected = rows.length > 0 && rows.every((unit) => selectedIds.includes(unit.id));
  const exportRows = () => rows.map((unit) => [unit.name, unit.shortName, unit.createdBy || user?.userName || 'admin', unit.createdAt || '']);
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Units copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `units.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Unit List</title></head><body><h2>Unit List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one unit');
    const confirmed = await confirmAction({ title: 'Delete Units', message: 'Delete selected units?', confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Item &gt; Unit List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Unit List</h1>
          {canCreate && <Button onClick={() => navigate('/items/units/create')} className="min-w-[170px]">Create Unit</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex flex-wrap items-center">{canDelete && <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>}<button onClick={copy} className={`h-10 border px-3 text-sm ${canDelete ? 'border-l-0' : 'rounded-l'}`}>Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {units.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((unit) => unit.id))} /></th>}{exportColumns.concat(showActions ? 'Action' : []).map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>{rows.length ? rows.map((unit: Unit) => <tr key={unit.id} className="border-b even:bg-gray-50">{canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(unit.id)} onChange={() => setSelectedIds((current) => current.includes(unit.id) ? current.filter((id) => id !== unit.id) : [...current, unit.id])} /></td>}<td className="border p-3 font-semibold">{unit.name}</td><td className="border p-3">{unit.shortName}</td><td className="border p-3">{unit.createdBy || user?.userName || 'admin'}</td><td className="border p-3">{unit.createdAt ? formatDate(unit.createdAt) : ''}</td>{showActions && <td className="border p-3"><div className="flex gap-2">{canUpdate && <button onClick={() => navigate(`/items/units/${unit.id}/edit`, { state: unit })} className="text-orange-600"><Edit size={16} /></button>}{canDelete && <button onClick={async () => { if (await confirmAction({ title: 'Delete Unit', message: 'Delete this unit?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(unit.id); }} className="text-red-600"><Trash2 size={16} /></button>}</div></td>}</tr>) : <tr><td colSpan={exportColumns.length + Number(canDelete) + Number(showActions)} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody>
          </table>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {units.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={units.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
      {confirmationDialog}
    </div>
  );
};
