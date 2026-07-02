import { useAuthStore } from '../store/auth.store.js';

export function usePermission(permission: string): boolean {
  return useAuthStore((s) => s.hasPermission(permission));
}

export function useHasAnyPermission(permissions: string[]): boolean {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  return permissions.some((p) => hasPermission(p));
}
