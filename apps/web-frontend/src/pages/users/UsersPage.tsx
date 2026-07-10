import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Lock, UserX, UserCog } from 'lucide-react';
import { userApi, adminSecurityApi } from '../../api/endpoints.js';
import { useAuthStore, type AuthUser } from '../../store/auth.store.js';
import { PERMISSIONS } from '../../constants/permissions.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPDataGrid, { type ERPColumnDef } from '../../components/erp/ERPDataGrid.js';
import ERPDropdownMenu, { type ERPMenuItem } from '../../components/erp/ERPDropdownMenu.js';
import ImpersonateConfirmDialog from '../../components/erp/ImpersonateConfirmDialog.js';
import Button from '../../components/ui/Button.js';
import Badge from '../../components/ui/Badge.js';

// Impersonation tokens carry the target's own roles/permissions/branches straight from
// auth-service (see impersonate.routes.ts) — decode them rather than guess at defaults.
function decodeJwtPayload(token: string): { exp?: number; tenantId?: number; roles?: string[]; permissions?: string[]; branchIds?: number[] } | null {
  try {
    return JSON.parse(atob(token.split('.')[1]!));
  } catch {
    return null;
  }
}

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
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreateUser = hasPermission(PERMISSIONS.USER_CREATE);
  const canUpdateUser = hasPermission(PERMISSIONS.USER_UPDATE);
  const canManageUser = hasPermission(PERMISSIONS.USER_MANAGE);
  const canDeleteUser = hasPermission(PERMISSIONS.USER_DELETE);
  const canImpersonate = hasPermission(PERMISSIONS.IMPERSONATE_USER);
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => userApi.list() });
  const users: User[] = (data as { content?: User[] })?.content ?? [];

  const [impersonateTarget, setImpersonateTarget] = useState<User | null>(null);

  const impersonateMutation = useMutation({
    mutationFn: (vars: { targetUserId: number; reason: string }) => adminSecurityApi.impersonate(vars),
    onSuccess: (result) => {
      const target = impersonateTarget;
      if (!target) return;
      const currentUser = useAuthStore.getState().user;
      const payload = decodeJwtPayload(result.accessToken);
      const expiresAt = payload?.exp ? payload.exp * 1000 : Date.now() + 60 * 60 * 1000;
      const impersonatedUser: AuthUser = {
        id: target.id,
        tenantId: payload?.tenantId ?? currentUser?.tenantId ?? 0,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        roles: payload?.roles ?? target.roles ?? [],
        permissions: payload?.permissions ?? [],
        branchIds: payload?.branchIds ?? [],
      };
      useAuthStore.getState().startImpersonation(result.accessToken, impersonatedUser, expiresAt);
      setImpersonateTarget(null);
      toast.success(`Now impersonating ${target.firstName} ${target.lastName}`);
      // Not '/dashboard' directly — the target user may lack DASHBOARD_VIEW, and '/' already
      // redirects to the first nav item they actually have access to (see IndexRedirect).
      navigate('/');
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

  const columns: ERPColumnDef<User>[] = [
    {
      key: 'name', header: 'Name', sortable: true,
      render: (r) => (
        <div>
          <p className="font-medium">{r.firstName} {r.lastName}</p>
          <p className="text-xs text-secondary">{r.email}</p>
        </div>
      ),
    },
    {
      key: 'roles', header: 'Roles',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.roles ?? []).map((role) => <Badge key={role} variant="info">{role}</Badge>)}
        </div>
      ),
    },
    {
      key: 'status', header: 'Status',
      render: (r) => {
        if (r.lockedUntil && new Date(r.lockedUntil) > new Date()) return <Badge variant="danger">Locked</Badge>;
        return <Badge variant={r.isActive ? 'success' : 'default'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>;
      },
    },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => {
        const items: ERPMenuItem[] = [];
        if (canUpdateUser) items.push({ label: 'Edit', icon: Pencil, onClick: () => navigate(`/users/${r.id}/edit`) });
        if (canManageUser) items.push({ label: 'Lock', icon: Lock, onClick: () => lockMutation.mutate(r.id) });
        if (canImpersonate) items.push({ label: 'Impersonate', icon: UserCog, onClick: () => setImpersonateTarget(r) });
        if (canDeleteUser) items.push({ label: 'Deactivate', icon: UserX, variant: 'danger', onClick: () => deleteMutation.mutate(r.id) });
        return items.length > 0 ? <ERPDropdownMenu items={items} /> : null;
      },
    },
  ];

  return (
    <div>
      <ERPPageHeader variant="list"
        title="Users"
        subtitle="Manage staff accounts and permissions."
        actions={canCreateUser ? <Button onClick={() => navigate('/users/new')}>+ New User</Button> : undefined}
      />
      <ERPDataGrid columns={columns} data={users} isLoading={isLoading} rowKey="id" />

      <ImpersonateConfirmDialog
        open={impersonateTarget !== null}
        targetUser={impersonateTarget}
        isLoading={impersonateMutation.isPending}
        onClose={() => setImpersonateTarget(null)}
        onConfirm={(reason) => {
          if (!impersonateTarget) return;
          impersonateMutation.mutate({ targetUserId: impersonateTarget.id, reason });
        }}
      />
    </div>
  );
}
