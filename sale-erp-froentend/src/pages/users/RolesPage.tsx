import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Edit, MoreVertical, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { rolesApi } from '../../api/endpoints';
import type { Role } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/Pagination';
import { useDebounce } from '../../hooks/useDebounce';
import { formatDate } from '../../utils/formatDate';

export const RolesPage: React.FC = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const debouncedSearch = useDebounce(search);

  const roles = useQuery({
    queryKey: ['roles', debouncedSearch],
    queryFn: () => rolesApi.getAll(debouncedSearch),
  });

  const remove = useMutation({
    mutationFn: rolesApi.delete,
    onSuccess: () => {
      toast.success('Role deleted');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to delete role'),
  });

  const allRows = roles.data?.data?.content || [];
  const rows = allRows.slice(page * pageSize, page * pageSize + pageSize);
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  const allSelected = rows.length > 0 && rows.every((role) => selectedIds.includes(role.id));

  const deleteSelected = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one role');
      return;
    }
    if (!confirm('Delete selected roles?')) return;
    for (const id of selectedIds) await remove.mutateAsync(id);
    setSelectedIds([]);
  };

  const deleteRole = (role: Role) => {
    if (confirm(`Delete role "${role.name}"?`)) remove.mutate(role.id);
    setOpenActionId(null);
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500">Home &gt; Users &gt; Permissions &gt; Roles List</div>
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h1 className="text-xl font-semibold uppercase text-gray-900">Roles List</h1>
          <Button onClick={() => navigate('/users/roles/create')} className="min-w-[170px]">Create Role</Button>
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
            <button type="button" onClick={deleteSelected} className="h-10 rounded-l border border-red-300 px-3 text-sm text-red-500">Delete</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Search:
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 rounded border border-gray-300 px-3" />
          </label>
        </div>

        <div className="overflow-x-auto px-3 pb-3">
          {roles.isLoading ? (
            <div className="p-10"><Loader /></div>
          ) : (
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : rows.map((role) => role.id))} /></th>
                  <th className="border p-3 text-left">Role Name</th>
                  <th className="border p-3 text-center">Status</th>
                  <th className="border p-3 text-left">Created at</th>
                  <th className="border p-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? rows.map((role) => {
                  const isActive = role.status === true || role.status === 'ACTIVE';
                  return (
                  <tr key={role.id} className="border-b even:bg-gray-50">
                    <td className="border p-3"><input type="checkbox" checked={selectedIds.includes(role.id)} onChange={() => setSelectedIds((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])} /></td>
                    <td className="border p-3 font-medium">{role.name}</td>
                    <td className="border p-3 text-center">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="border p-3">{role.createdAt ? formatDate(role.createdAt) : ''}</td>
                    <td className="relative border p-3">
                      <button type="button" className="rounded p-1 hover:bg-gray-100" onClick={() => setOpenActionId(openActionId === role.id ? null : role.id)}>
                        <MoreVertical size={18} />
                      </button>
                      {openActionId === role.id && (
                        <div className="absolute right-8 top-8 z-10 w-28 rounded border bg-white py-1 shadow">
                          <button type="button" onClick={() => navigate(`/users/roles/${role.id}/edit`)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50"><Edit size={14} /> Edit</button>
                          <button type="button" onClick={() => deleteRole(role)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-50"><Trash2 size={14} /> Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                }) : (
                  <tr><td colSpan={5} className="bg-gray-50 p-5 text-center">No data available in table</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-gray-600">
          <span>Showing {rows.length ? page * pageSize + 1 : 0} to {page * pageSize + rows.length} of {allRows.length} entries</span>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
};
