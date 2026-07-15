import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { clearTokens } from '../../auth.js';

// Every "bare" pos-frontend screen (login, branch-select, shift open/close, access-denied,
// account-suspended) renders full-viewport with no shared header/nav — before this, a user
// stuck on one of them (e.g. an under-permissioned role, or a mid-flow error) had no way to
// sign out and try a different account short of clearing storage manually. Fixed corner
// placement so it doesn't disturb any of those screens' existing centered-card layout.
export default function POSLogoutLink() {
  const navigate = useNavigate();

  function handleLogout() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  return (
    <button
      onClick={handleLogout}
      className="fixed top-4 right-4 flex items-center gap-1 text-xs font-medium text-secondary hover:text-primary transition-colors"
    >
      <LogOut size={14} />
      Logout
    </button>
  );
}
