import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { userApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import DataTable from '../../components/ui/DataTable.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';

interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  isActive: boolean;
  lockedUntil?: string;
  roles?: string[];
}

export default function UsersPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => userApi.list() });
  const users: User[] = (data as { data?: { content?: User[] } })?.data?.content ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: number) => userApi.delete(id),
    onSuccess: () => { toast.success('User deactivated'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const lockMutation = useMutation({
    mutationFn: (id: number) => userApi.lock(id),
    onSuccess: () => { toast.success('User locked'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = [
    {
      key: 'name', header: 'Name',
      render: (r: User) => (
        <div>
          <p className="font-medium">{r.firstName} {r.lastName}</p>
          <p className="text-xs text-gray-400">{r.email}</p>
        </div>
      ),
    },
    {
      key: 'roles', header: 'Roles',
      render: (r: User) => (
        <div className="flex flex-wrap gap-1">
          {(r.roles ?? []).map((role) => <Badge key={role} label={role} color="blue" />)}
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (r: User) => {
        if (r.lockedUntil && new Date(r.lockedUntil) > new Date()) return <Badge label="Locked" color="red" />;
        return <Badge label={r.isActive ? 'Active' : 'Inactive'} color={r.isActive ? 'green' : 'gray'} />;
      },
    },
    {
      key: 'actions', header: '',
      render: (r: User) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/users/${r.id}/edit`)}>Edit</Button>
          <Button size="sm" variant="secondary" onClick={() => lockMutation.mutate(r.id)}>Lock</Button>
          <Button size="sm" variant="danger" onClick={() => deleteMutation.mutate(r.id)}>Deactivate</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Users"
        subtitle="Manage staff accounts and permissions."
        actions={<Button onClick={() => navigate('/users/new')}>+ New User</Button>}
      />
      <DataTable columns={columns} data={users} loading={isLoading} emptyMessage="No users found." />
    </div>
  );
}
