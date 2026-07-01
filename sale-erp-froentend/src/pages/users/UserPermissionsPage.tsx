import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Search, ShieldCheck, UserRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { permissionsApi, usersApi } from '../../api/endpoints';
import { queryClient } from '../../app/queryClient';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';

export const UserPermissionsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [selectedUserId, setSelectedUserId] = useState(Number(searchParams.get('userId')) || 0);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');

  const users = useQuery({
    queryKey: ['users', 'permission-assignment'],
    queryFn: () => usersApi.getAll({ page: 0, size: 500, search: '' }),
  });
  const permissions = useQuery({
    queryKey: ['permissions', 'grouped'],
    queryFn: permissionsApi.getAll,
  });
  const selectedUserPermissions = useQuery({
    queryKey: ['permissions', 'user', selectedUserId],
    queryFn: () => permissionsApi.getForUser(selectedUserId),
    enabled: selectedUserId > 0,
  });

  const userRows = users.data?.data?.content || [];
  const selectedUser = userRows.find((entry) => entry.id === selectedUserId);
  const permissionGroups = permissions.data?.data || {};

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedPermissionIds([]);
      return;
    }
    if (selectedUserPermissions.data?.data) {
      setSelectedPermissionIds(selectedUserPermissions.data.data.map((permission) => permission.id));
    }
  }, [selectedUserPermissions.data?.data, selectedUserId]);

  const filteredGroups = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return Object.entries(permissionGroups)
      .map(([groupName, groupPermissions]) => [
        groupName,
        groupPermissions.filter((permission) =>
          !normalizedSearch
          || groupName.toLowerCase().includes(normalizedSearch)
          || permission.description.toLowerCase().includes(normalizedSearch)
        ),
      ] as const)
      .filter(([, groupPermissions]) => groupPermissions.length > 0);
  }, [permissionGroups, search]);

  const allPermissionIds = useMemo(
    () => Object.values(permissionGroups).flat().map((permission) => permission.id),
    [permissionGroups]
  );
  const allSelected = allPermissionIds.length > 0
    && allPermissionIds.every((permissionId) => selectedPermissionIds.includes(permissionId));

  const assignment = useMutation({
    mutationFn: permissionsApi.assignToUser,
    onSuccess: async () => {
      toast.success('Permissions assigned successfully. The user must sign in again to receive a new token.');
      await queryClient.invalidateQueries({ queryKey: ['permissions', 'user', selectedUserId] });
      await queryClient.invalidateQueries({ queryKey: ['permissions', 'current-user'] });
    },
    onError: (error: any) => toast.error(error?.message || 'Failed to assign permissions'),
  });

  const togglePermission = (permissionId: number) => {
    setSelectedPermissionIds((current) =>
      current.includes(permissionId)
        ? current.filter((id) => id !== permissionId)
        : [...current, permissionId]
    );
  };

  const toggleGroup = (groupPermissionIds: number[]) => {
    const groupSelected = groupPermissionIds.every((id) => selectedPermissionIds.includes(id));
    setSelectedPermissionIds((current) => groupSelected
      ? current.filter((id) => !groupPermissionIds.includes(id))
      : [...new Set([...current, ...groupPermissionIds])]
    );
  };

  const toggleAll = () => {
    setSelectedPermissionIds(allSelected ? [] : allPermissionIds);
  };

  const submit = () => {
    if (!selectedUserId) {
      toast.error('Please select a user');
      return;
    }
    if (!selectedPermissionIds.length) {
      toast.error('Select at least one permission');
      return;
    }
    assignment.mutate({
      userId: selectedUserId,
      permissionIds: selectedPermissionIds,
    });
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-gray-500 dark:text-slate-400">Home &gt; Users &gt; Permissions</div>

      <div className="flex max-h-[calc(100vh-7rem)] min-h-[620px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-950/40">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">User Permissions</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Select a user and assign permissions group wise.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-1 dark:ring-blue-800/60">
            <ShieldCheck size={17} />
            {selectedPermissionIds.length} selected
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-b border-slate-200 bg-slate-50/70 p-5 dark:border-slate-700 dark:bg-slate-900/70 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            Select User
            <select
              value={selectedUserId}
              disabled={users.isLoading}
              onChange={(event) => setSelectedUserId(Number(event.target.value))}
              className="mt-1.5 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-900/40"
            >
              <option value={0}>{users.isLoading ? 'Loading users...' : 'Choose a user'}</option>
              {userRows.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.firstName || entry.lastName
                    ? `${entry.firstName || ''} ${entry.lastName || ''}`.trim()
                    : entry.userName || entry.username || `User ${entry.id}`}
                  {' - '}
                  {entry.userName || entry.username || entry.email || entry.id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
            Search Permission
            <span className="relative mt-1.5 block">
              <Search className="absolute left-3 top-3 text-gray-400 dark:text-slate-500" size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search group or description"
                className="h-11 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-400 dark:focus:ring-blue-900/40"
              />
            </span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <label className="inline-flex cursor-pointer items-center gap-3 text-sm font-semibold text-gray-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={!allPermissionIds.length}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 accent-blue-600 dark:border-slate-500"
            />
            Select all permissions
          </label>
          {selectedUser && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
              <UserRound size={17} />
              <span>{selectedUser.userName || selectedUser.username || selectedUser.email}</span>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {permissions.isLoading || selectedUserPermissions.isFetching ? (
            <div className="p-12"><Loader /></div>
          ) : permissions.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              Unable to load permissions.
            </div>
          ) : filteredGroups.length ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {filteredGroups.map(([groupName, groupPermissions]) => {
                const groupIds = groupPermissions.map((permission) => permission.id);
                const selectedCount = groupIds.filter((id) => selectedPermissionIds.includes(id)).length;
                const groupSelected = groupIds.length > 0 && selectedCount === groupIds.length;

                return (
                  <section key={groupName} className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={groupSelected}
                          onChange={() => toggleGroup(groupIds)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 accent-blue-600 dark:border-slate-500"
                        />
                        <span className="font-semibold text-slate-800 dark:text-slate-100">{groupName}</span>
                      </label>
                      <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-300 dark:ring-1 dark:ring-slate-700">
                        {selectedCount}/{groupIds.length}
                      </span>
                    </div>

                    <div className="divide-y divide-slate-100 dark:divide-slate-700/70">
                      {groupPermissions.map((permission) => {
                        const checked = selectedPermissionIds.includes(permission.id);
                        return (
                          <label
                            key={permission.id}
                            className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition ${
                              checked ? 'bg-blue-50/60 dark:bg-blue-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                            }`}
                          >
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                              checked
                                ? 'border-blue-600 bg-blue-600 text-white'
                                : 'border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-900'
                            }`}>
                              <Check size={14} />
                            </span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(permission.id)}
                              className="sr-only"
                            />
                            <span className="text-sm leading-6 text-slate-700 dark:text-slate-300">{permission.description}</span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No permissions match your search.
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {selectedPermissionIds.length} permissions selected
            </span>
            <Button
              type="button"
              onClick={submit}
              isLoading={assignment.isPending}
              disabled={!selectedUserId || !selectedPermissionIds.length}
              className="min-w-[180px]"
            >
              Assign Permissions
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
