import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, MoreVertical, ShieldCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { usersApi } from '../../api/endpoints';
import type { UserListItem } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useConfirmation } from '../../hooks/useConfirmation';
import { useDebounce } from '../../hooks/useDebounce';
import { formatDate } from '../../utils/formatDate';
import { useAuth } from '../../hooks/useAuth';
import { PERMISSIONS } from '../../auth/permissions';

const columns = ['Username', 'First Name', 'Last Name', 'Email', 'Mobile', 'Role', 'Status', 'Created at', 'Action'];

export const UserListPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { confirmAction, confirmationDialog } = useConfirmation();
  const canCreate = hasPermission(PERMISSIONS.ORGANIZATION_VIEW) && hasPermission(PERMISSIONS.ROLE_MANAGE);
  const canEdit = hasPermission(PERMISSIONS.ROLE_MANAGE);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const debouncedSearch = useDebounce(search);
  const users = useQuery({
    queryKey: ['users', page, pageSize, debouncedSearch],
    queryFn: () => usersApi.getAll({ page, size: pageSize, search: debouncedSearch }),
  });
  const rows = users.data?.data?.content || [];
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const remove = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => {
      toast.success('User deleted');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete user'),
  });

  const copy = async () => {
    const exportRows = rows.map((row) => [row.userName || row.username || '', row.firstName || '', row.lastName || '', row.email || '', row.mobileNo || row.mobile || '', row.roleName || '', row.status ?? '', row.createdAt || '']);
    await navigator.clipboard.writeText([columns.slice(0, -1), ...exportRows].map((entry) => entry.join('\t')).join('\n'));
    toast.success('Users copied');
  };
  const deleteSelected = async () => {
    if (!selectedIds.length) return toast.error('Select at least one user');
    const confirmed = await confirmAction({ title: 'Delete Users', message: 'Delete selected users?', confirmText: 'Delete', variant: 'danger' });
    if (!confirmed) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Users &gt; Users List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Users List</h1>
          {canCreate && <Button onClick={() => navigate('/users/create')} className="min-w-[170px]">Create User</Button>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Show
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }} className="h-9 rounded border border-gray-300 px-2">
              <option>10</option>
              <option>20</option>
              <option>50</option>
              <option>100</option>
            </select>
            entries
          </label>
          <div className="flex flex-wrap items-center">
            <button type="button" onClick={deleteSelected} className="h-10 rounded-l border border-red-300 bg-red-500 px-3 text-sm text-white">Delete</button>
            <button type="button" onClick={copy} className="h-10 border-y border-r px-3 text-sm">Copy</button>
            <button type="button" onClick={copy} className="h-10 border-y border-r px-3 text-sm">Excel</button>
            <button type="button" onClick={copy} className="h-10 border-y border-r px-3 text-sm">CSV</button>
            <button type="button" onClick={copy} className="h-10 rounded-r border-y border-r px-3 text-sm">PDF</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Search:
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" />
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {users.isLoading ? <div className="p-10"><Loader /></div> : <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((row) => row.id))} /></th>
                {columns.map((heading) => <th key={heading} className="border p-3 text-left">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row: UserListItem) => {
                  const isActive = row.status === true || row.status === 'ACTIVE';
                return (
                <tr key={row.id} className="border-b even:bg-gray-50">
                  <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></td>
                  <td className="border p-3">{row.userName || row.username || ''}</td>
                  <td className="border p-3">{row.firstName || ''}</td>
                  <td className="border p-3">{row.lastName || ''}</td>
                  <td className="border p-3">{row.email || ''}</td>
                  <td className="border p-3">{row.mobileNo || row.mobile || ''}</td>
                  <td className="border p-3">{row.roleName || ''}</td>
                  <td className="border p-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="border p-3">{row.createdAt ? formatDate(row.createdAt) : ''}</td>
                  <td className="border p-3"><div className="flex gap-2">{canEdit && <button type="button" title="Edit user" onClick={() => navigate(`/users/${row.id}/edit`, { state: row })} className="text-orange-600"><Edit size={16} /></button>}<button type="button" title="Assign permissions" onClick={() => navigate(`/users/permissions?userId=${row.id}`)} className="text-blue-600"><ShieldCheck size={16} /></button><button type="button" title="Delete user" onClick={async () => { if (await confirmAction({ title: 'Delete User', message: 'Delete this user?', confirmText: 'Delete', variant: 'danger' })) remove.mutate(row.id); }} className="text-red-600"><Trash2 size={16} /></button><MoreVertical size={16} /></div></td>
                </tr>
                );
              }) : (
                <tr><td colSpan={10} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>
              )}
            </tbody>
          </table>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {users.data?.data?.totalElements || 0} entries</span>
          <Pagination page={page} totalPages={users.data?.data?.totalPages || 1} onPageChange={setPage} />
        </div>
      </div>
      {confirmationDialog}
    </div>
  );
};
