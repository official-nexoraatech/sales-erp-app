import React, { useState } from 'react';
import {
  ChevronDown,
  Grid2X2,
  Lock,
  LogOut,
  Moon,
  Plus,
  Sun,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '../../auth/permissions';
import { useAuth } from '../../hooks/useAuth';

export const AppHeader: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, hasPermission } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [darkIcon, setDarkIcon] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-indigo-100 bg-white px-4 shadow-[0_3px_12px_rgba(79,70,229,0.08)] md:px-6">
      <div className="pl-10 text-sm font-semibold text-slate-700 md:pl-0">
        <span className="hidden sm:inline">{user?.organizationName || 'BillTop'}</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 lg:flex">
          {hasPermission(PERMISSIONS.PURCHASE_CREATE) && (
            <button
              type="button"
              onClick={() => navigate('/purchase/bills/create')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-400 px-4 text-xs font-semibold text-sky-600 transition hover:bg-sky-50"
            >
              <Plus size={14} /> Purchase
            </button>
          )}
          {hasPermission(PERMISSIONS.SALES_CREATE) && (
            <button
              type="button"
              onClick={() => navigate('/sales/invoices/create')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-400 px-4 text-xs font-semibold text-rose-500 transition hover:bg-rose-50"
            >
              <Plus size={14} /> Sale
            </button>
          )}
          {hasPermission(PERMISSIONS.SALES_CREATE) && (
            <button
              type="button"
              onClick={() => navigate('/sales/pos')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-500 px-5 text-xs font-semibold text-white transition hover:bg-emerald-600"
            >
              <Plus size={14} /> POS
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
          aria-label="Open dashboard"
        >
          <Grid2X2 size={18} />
        </button>
        <span className="hidden text-xl sm:inline" aria-label="India">🇮🇳</span>
        <button
          type="button"
          onClick={() => setDarkIcon((current) => !current)}
          className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100"
          aria-label="Toggle appearance"
        >
          {darkIcon ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div className="relative ml-1 border-l border-slate-200 pl-3">
          <button
            type="button"
            onClick={() => setProfileOpen((current) => !current)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-slate-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-500">
              {user?.userName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="hidden min-w-20 sm:block">
              <p className="max-w-28 truncate text-xs font-semibold text-slate-800">{user?.userName || 'User'}</p>
              <p className="max-w-28 truncate text-[11px] text-slate-500">{user?.role || 'User'}</p>
            </div>
            <ChevronDown size={14} className="hidden text-slate-400 sm:block" />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-12 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
              {hasPermission(PERMISSIONS.USER_PROFILE) && (
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/profile', { state: { panel: 'profile' } });
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50"
                >
                  <User size={16} /> Profile
                </button>
              )}
              {hasPermission(PERMISSIONS.USER_CHANGE_PASSWORD) && (
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/profile', { state: { panel: 'password' } });
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50"
                >
                  <Lock size={16} /> Change Password
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <LogOut size={16} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

