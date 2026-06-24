import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { brandApi, categoryApi } from '../../api/endpoints';
import type { SimpleMaster } from '../../api/endpoints';
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

interface Props { type: 'category' | 'brand' }

export const MasterListPage: React.FC<Props> = ({ type }) => {
  const isCategory = type === 'category';
  const api = isCategory ? categoryApi : brandApi;
  const label = isCategory ? 'Category' : 'Brand';
  const exportColumns = isCategory ? ['Name', 'Description', 'Created by', 'Created at'] : ['Category', 'Name', 'Description', 'Created by', 'Created at'];
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const hasCategoryLookup = isCategory || hasPermission(PERMISSIONS.CATEGORY_VIEW);
  const canCreate = hasPermission(isCategory ? PERMISSIONS.CATEGORY_CREATE : PERMISSIONS.BRAND_CREATE) && hasCategoryLookup;
  const canUpdate = hasPermission(isCategory ? PERMISSIONS.CATEGORY_UPDATE : PERMISSIONS.BRAND_UPDATE) && hasCategoryLookup;
  const canDelete = hasPermission(isCategory ? PERMISSIONS.CATEGORY_DELETE : PERMISSIONS.BRAND_DELETE);
  const showActions = canUpdate || canDelete;
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);

  const records = useQuery({ queryKey: [type, page, pageSize, debouncedSearch], queryFn: () => api.getAll({ page, size: pageSize, search: debouncedSearch }) });
  const remove = useMutation({
    mutationFn: api.delete,
    onSuccess: () => {
      toast.success(`${label} deleted`);
      queryClient.invalidateQueries({ queryKey: [type] });
    },
    onError: (error: any) => toast.error(error?.message || `Failed to delete ${label.toLowerCase()}`),
  });

  const rows = records.data?.data?.content || [];
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const exportRows = () => rows.map((row) => isCategory
    ? [row.name, row.description || '', row.createdBy || user?.userName || 'admin', row.createdAt || '']
    : [row.categoryName || '', row.name, row.description || '', row.createdBy || user?.userName || 'admin', row.createdAt || '']
  );
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success(`${label}s copied`);
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}s.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>${label} List</title></head><body><h2>${label} List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error(`Select at least one ${label.toLowerCase()}`);
    const confirmed = await confirmAction({ title: `Delete ${label}s`, message: `Delete selected ${label.toLowerCase()} records?`, confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Item &gt; {label} List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">{label} List</h1>
          {canCreate && <Button onClick={() => navigate(`/items/${isCategory ? 'categories' : 'brands'}/create`)} className="min-w-[170px]">Create {label}</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <div className="flex flex-wrap items-center">{canDelete && <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>}<button onClick={copy} className={`h-10 border px-3 text-sm ${canDelete ? 'border-l-0' : 'rounded-l'}`}>Copy</button><button onClick={() => download('xls')} className="h-10 border-y border-r px-3 text-sm">Excel</button><button onClick={() => download('csv')} className="h-10 border-y border-r px-3 text-sm">CSV</button><button onClick={printPdf} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button></div>
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {records.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>{canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row.id))} /></th>}{exportColumns.concat(showActions ? 'Action' : []).map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
            <tbody>{rows.length ? rows.map((row: SimpleMaster) => <tr key={row.id} className="border-b even:bg-gray-50">{canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></td>}{!isCategory && <td className="border p-3">{row.categoryName || ''}</td>}<td className="border p-3 font-semibold">{row.name}</td><td className="border p-3">{row.description || ''}</td><td className="border p-3">{row.createdBy || user?.userName || 'admin'}</td><td className="border p-3">{row.createdAt ? formatDate(row.createdAt) : ''}</td>{showActions && <td className="border p-3"><div className="flex gap-2">{canUpdate && <button onClick={() => navigate(`/items/${isCategory ? 'categories' : 'brands'}/${row.id}/edit`, { state: row })} className="text-orange-600"><Edit size={16} /></button>}{canDelete && <button onClick={async () => { if (await confirmAction({ title: `Delete ${label}`, message: `Delete this ${label.toLowerCase()}?`, confirmText: 'Delete', variant: 'danger' })) remove.mutate(row.id); }} className="text-red-600"><Trash2 size={16} /></button>}</div></td>}</tr>) : <tr><td colSpan={exportColumns.length + Number(canDelete) + Number(showActions)} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}</tbody>
          </table>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600"><span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {records.data?.data?.totalElements || 0} entries</span><Pagination page={page} totalPages={records.data?.data?.totalPages || 1} onPageChange={handlePageChange} /></div>
      </div>
      {confirmationDialog}
    </div>
  );
};
