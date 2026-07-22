import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, Eye, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { branchApi } from '../../api/endpoints';
import type { Branch } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { useConfirmation } from '../../hooks/useConfirmation';
import { usePagination } from '../../hooks/usePagination';
import { formatDate } from '../../utils/formatDate';
import { PERMISSIONS } from '../../auth/permissions';
import { TableExportButtons } from '../../components/common/TableExportButtons';

const exportColumns = ['Branch Code', 'Branch Name', 'City', 'Phone', 'Email', 'Status', 'Created by', 'Created at'];

export const BranchListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const canCreate = hasPermission(PERMISSIONS.BRANCH_CREATE);
  const canUpdate = hasPermission(PERMISSIONS.BRANCH_UPDATE);
  const canDelete = hasPermission(PERMISSIONS.BRANCH_DELETE);
  const { confirmAction, confirmationDialog } = useConfirmation();
  const { page, setPage, handlePageChange } = usePagination();
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const branches = useQuery({ queryKey: ['branches', search], queryFn: () => branchApi.getAll(search) });
  const remove = useMutation({
    mutationFn: branchApi.delete,
    onSuccess: () => {
      toast.success('Branch deleted');
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete branch'),
  });
  const allRows: Branch[] = Array.isArray(branches.data?.data) ? branches.data?.data || [] : [];
  const rows = allRows.slice(page * pageSize, page * pageSize + pageSize);
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const allSelected = rows.length > 0 && rows.every((branch) => selectedIds.includes(branch.id));
  const exportRows = () => allRows.map((branch) => [
    branch.branchCode,
    branch.branchName,
    branch.city || '',
    branch.phone || '',
    branch.email || '',
    branch.isActive ? 'Active' : 'Inactive',
    branch.createdBy || user?.userName || 'admin',
    branch.createdAt || '',
  ]);
  const copy = async () => {
    await navigator.clipboard.writeText([exportColumns, ...exportRows()].map((row) => row.join('\t')).join('\n'));
    toast.success('Branches copied');
  };
  const download = (extension: 'csv' | 'xls') => {
    const separator = extension === 'csv' ? ',' : '\t';
    const content = [exportColumns, ...exportRows()].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(separator)).join('\n');
    const blob = new Blob([content], { type: extension === 'csv' ? 'text/csv' : 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `branches.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const printPdf = () => {
    const popup = window.open('', '_blank');
    if (!popup) return;
    popup.document.write(`<html><head><title>Branch List</title></head><body><h2>Branch List</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${exportColumns.map((column) => `<th>${column}</th>`).join('')}</tr></thead><tbody>${exportRows().map((row) => `<tr>${row.map((value) => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    popup.document.close();
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one branch');
    const confirmed = await confirmAction({ title: 'Delete Branches', message: 'Delete selected branches?', confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Management &gt; Branches</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Branch List</h1>
          {canCreate && <Button onClick={() => navigate('/branches/create')} className="min-w-[180px]">Create Branch</Button>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">Show<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2"><option>10</option><option>20</option><option>50</option><option>100</option></select>entries</label>
          <TableExportButtons
            onCopy={copy}
            onDownloadExcel={() => download('xls')}
            onDownloadCsv={() => download('csv')}
            onPrint={printPdf}
            leadingButton={canDelete && <button onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500 transition-all active:scale-95 active:bg-red-50">Delete</button>}
          />
          <label className="flex items-center gap-2 text-sm text-gray-600">Search:<input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 rounded border border-gray-300 px-3" /></label>
        </div>
        <div className="overflow-x-auto px-3 pb-3">
          {branches.isLoading ? <div className="p-10"><Loader /></div> : (
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50"><tr>{canDelete && <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((branch) => branch.id))} /></th>}{exportColumns.concat('Action').map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}</tr></thead>
              <tbody>
                {rows.length ? rows.map((branch) => (
                  <tr key={branch.id} className="border-b even:bg-gray-50">
                    {canDelete && <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(branch.id)} onChange={() => setSelectedIds((current) => current.includes(branch.id) ? current.filter((id) => id !== branch.id) : [...current, branch.id])} /></td>}
                    <td className="border p-3 font-semibold">{branch.branchCode}</td>
                    <td className="border p-3">{branch.branchName}</td>
                    <td className="border p-3">{branch.city || 'N/A'}</td>
                    <td className="border p-3">{branch.phone || 'N/A'}</td>
                    <td className="border p-3">{branch.email || 'N/A'}</td>
                    <td className="border p-3">
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {branch.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="border p-3">{branch.createdBy || user?.userName || 'admin'}</td>
                    <td className="border p-3">{branch.createdAt ? formatDate(branch.createdAt) : ''}</td>
                    <td className="border p-3"><div className="flex gap-2"><button title="View branch" onClick={() => navigate(`/branches/${branch.id}`)} className="text-blue-600"><Eye size={16} /></button>{canUpdate && <button title="Edit branch" onClick={() => navigate(`/branches/${branch.id}/edit`, { state: branch })} className="text-orange-600"><Edit size={16} /></button>}{canDelete && <button title="Delete branch" onClick={async () => { if (await confirmAction({ title: 'Delete Branch', message: 'Delete this branch?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(branch.id); }} className="text-red-600"><Trash2 size={16} /></button>}</div></td>
                  </tr>
                )) : <tr><td colSpan={9} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>}
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
