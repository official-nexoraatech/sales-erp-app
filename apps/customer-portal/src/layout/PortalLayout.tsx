import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LifeBuoy, Gift, Share2, Settings, LogOut } from 'lucide-react';
import { usePortalAuthStore } from '../store/portalAuth.store.js';
import { portalApiClient } from '../api/portalApiClient.js';

const NAV_ITEMS = [
  { to: '/', label: 'My Orders', icon: LayoutDashboard, end: true },
  { to: '/tickets', label: 'Support', icon: LifeBuoy, end: false },
  { to: '/loyalty', label: 'Rewards', icon: Gift, end: false },
  { to: '/referral', label: 'Refer a Friend', icon: Share2, end: false },
  { to: '/preferences', label: 'Preferences', icon: Settings, end: false },
];

export function PortalLayout(): React.ReactElement {
  const customer = usePortalAuthStore((s) => s.customer);
  const logout = usePortalAuthStore((s) => s.logout);
  const navigate = useNavigate();

  async function handleLogout(): Promise<void> {
    try {
      await portalApiClient.post('auth', '/auth/portal/logout');
    } finally {
      logout();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-default)] bg-[var(--surface-card)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="font-semibold">My Account</div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-[var(--text-secondary)]">{customer?.displayName}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[var(--surface-subtle)]"
            >
              <LogOut size={16} /> Log out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${
                  isActive
                    ? 'bg-[var(--surface-subtle)] font-medium text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
