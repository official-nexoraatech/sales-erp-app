import type { ReactNode } from 'react';
import { usePermission } from '../hooks/usePermission.js';

interface Props {
  permission: string;
  fallback?: ReactNode;
  children: ReactNode;
}

export default function PermissionGate({ permission, fallback = null, children }: Props) {
  const allowed = usePermission(permission);
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
