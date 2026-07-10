import { useAuthStore } from '../store/auth.store.js';
import ERPEmptyState from '../components/erp/ERPEmptyState.js';

export default function NoModulesAssignedPage() {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-page">
      <ERPEmptyState
        type="no-access"
        title="No modules assigned yet"
        description="Your account doesn't have access to any part of the system yet. Contact your administrator to have modules assigned to your role."
        action={{ label: 'Log out', onClick: logout }}
      />
    </div>
  );
}
