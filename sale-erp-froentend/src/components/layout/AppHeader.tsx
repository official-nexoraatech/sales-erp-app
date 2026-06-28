import React, { useEffect, useRef, useState } from 'react';
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
import { LANGUAGE_OPTIONS, usePageTranslation } from '../../hooks/usePageTranslation';
import type { AppLanguage } from '../../hooks/usePageTranslation';
import { useTheme } from '../../contexts/ThemeContext';

const getStoredLanguage = (): AppLanguage => {
  const language = localStorage.getItem('language');
  return LANGUAGE_OPTIONS.some((option) => option.value === language) ? language as AppLanguage : 'en';
};

export const AppHeader: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, hasPermission } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const [language, setLanguage] = useState<AppLanguage>(getStoredLanguage);

  usePageTranslation(language);

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  useEffect(() => {
    if (!profileOpen) return;

    const closeOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && !profileMenuRef.current?.contains(target)) {
        setProfileOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('touchstart', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('touchstart', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileOpen]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-900/40 md:px-6">
      <div className="pl-10 text-sm font-semibold text-slate-700 dark:text-slate-200 md:pl-0">
        <span className="hidden sm:inline">{user?.organizationName || 'Texmintra'}</span>
      </div>

      <div className="flex items-center gap-1.5">
        {/* Quick-create buttons (desktop only) */}
        <div className="hidden items-center gap-1.5 lg:flex">
          {hasPermission(PERMISSIONS.PURCHASE_CREATE) && (
            <button
              type="button"
              onClick={() => navigate('/purchase/bills/create')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-sky-400 px-3.5 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 dark:border-sky-500 dark:text-sky-400 dark:hover:bg-sky-900/20"
            >
              <Plus size={13} /> Purchase
            </button>
          )}
          {hasPermission(PERMISSIONS.SALES_CREATE) && (
            <button
              type="button"
              onClick={() => navigate('/sales/invoices/create')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rose-400 px-3.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 dark:border-rose-500 dark:text-rose-400 dark:hover:bg-rose-900/20"
            >
              <Plus size={13} /> Sale
            </button>
          )}
          {hasPermission(PERMISSIONS.POS_BILLING_CREATE) && (
            <button
              type="button"
              onClick={() => navigate('/sales/pos')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-500 px-4 text-xs font-semibold text-white transition hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              <Plus size={13} /> POS
            </button>
          )}
        </div>

        {/* Dashboard */}
        {hasPermission(PERMISSIONS.DASHBOARD_VIEW) && (
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Open dashboard"
            title="Dashboard"
          >
            <Grid2X2 size={18} />
          </button>
        )}

        {/* Language selector */}
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as AppLanguage)}
          className="hidden h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 outline-none transition hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 dark:focus:border-blue-400 dark:focus:ring-blue-900/30 sm:block"
          aria-label="Language"
          title="Language"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Profile menu */}
        <div ref={profileMenuRef} className="relative ml-1 border-l border-slate-200 pl-2.5 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setProfileOpen((current) => !current)}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700"
            title="Profile menu"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white dark:bg-blue-500">
              {user?.userName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="hidden min-w-16 sm:block">
              <p className="max-w-24 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                {user?.userName || 'User'}
              </p>
              <p className="max-w-24 truncate text-[11px] text-slate-500 dark:text-slate-400">
                {user?.role || 'User'}
              </p>
            </div>
            <ChevronDown
              size={13}
              className={`hidden text-slate-400 dark:text-slate-500 sm:block transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {profileOpen && (
            <div
              className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-900/70"
              role="menu"
            >
              {hasPermission(PERMISSIONS.USER_PROFILE_VIEW) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/profile', { state: { panel: 'profile' } });
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                >
                  <User size={15} /> Profile
                </button>
              )}
              {hasPermission(PERMISSIONS.USER_CHANGE_PASSWORD) && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate('/profile', { state: { panel: 'password' } });
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                >
                  <Lock size={15} /> Change Password
                </button>
              )}
              <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
              <button
                type="button"
                role="menuitem"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <LogOut size={15} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
