import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store.js';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';

export default function NoModulesAssignedPage() {
  const logout = useAuthStore((s) => s.logout);
  const queryClient = useQueryClient();

  function handleLogout() {
    logout();
    // See WEB-FRONTEND-AUDIT-2026-07-24.md, Critical #1 — without this the next user to
    // log in on this browser can see this user's cached data until each query refetches.
    queryClient.clear();
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-page">
      <ERPEmptyState
        type="no-access"
        title="No modules assigned yet"
        description="Your account doesn't have access to any part of the system yet. Contact your administrator to have modules assigned to your role."
        action={{ label: 'Log out', onClick: handleLogout }}
      />
    </div>
  );
}
