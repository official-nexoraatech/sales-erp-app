import React, { useEffect, useState } from 'react';
import {
  Grid2X2,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PERMISSIONS } from '../../auth/permissions';
import { useAuth } from '../../hooks/useAuth';
import { LANGUAGE_OPTIONS, usePageTranslation } from '../../hooks/usePageTranslation';
import type { AppLanguage } from '../../hooks/usePageTranslation';
import { useTheme } from '../../contexts/ThemeContext';
import { BranchSwitcher } from './BranchSwitcher';

const getStoredLanguage = (): AppLanguage => {
  const language = localStorage.getItem('language');
  return LANGUAGE_OPTIONS.some((option) => option.value === language) ? language as AppLanguage : 'en';
};

export const AppHeader: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [language, setLanguage] = useState<AppLanguage>(getStoredLanguage);

  usePageTranslation(language);

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:shadow-slate-900/40 md:px-6">
      <div className="flex items-center gap-1.5 pl-10 text-sm font-semibold text-slate-700 dark:text-slate-200 md:pl-0">
        <BranchSwitcher />
      </div>

      <div className="flex items-center gap-1.5">
        {/* Quick-create buttons (desktop only) */}
        <div className="hidden items-center gap-1.5 lg:flex">
          {hasPermission(PERMISSIONS.CUSTOMER_VIEW) && (
            <button
              type="button"
              onClick={() => navigate('/contacts/customers')}
              className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-full border border-violet-400 px-3.5 text-xs font-semibold text-violet-600 transition hover:bg-violet-50 dark:border-violet-500 dark:text-violet-400 dark:hover:bg-violet-900/20"
            >
              Customers
            </button>
          )}
          {hasPermission(PERMISSIONS.ITEM_VIEW) && (
            <button
              type="button"
              onClick={() => navigate('/items')}
              className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-full border border-amber-400 px-3.5 text-xs font-semibold text-amber-600 transition hover:bg-amber-50 dark:border-amber-500 dark:text-amber-400 dark:hover:bg-amber-900/20"
            >
              Items
            </button>
          )}
          {hasPermission(PERMISSIONS.EXPENSE_VIEW) && (
            <button
              type="button"
              onClick={() => navigate('/expenses')}
              className="inline-flex h-8 min-w-[92px] items-center justify-center rounded-full border border-teal-400 px-3.5 text-xs font-semibold text-teal-600 transition hover:bg-teal-50 dark:border-teal-500 dark:text-teal-400 dark:hover:bg-teal-900/20"
            >
              Expenses
            </button>
          )}
          {/* Routing intentionally left unwired - payment module is still being built. */}
          <button
            type="button"
            disabled
            title="Coming soon"
            className="inline-flex h-8 min-w-[92px] cursor-not-allowed items-center justify-center rounded-full border border-fuchsia-300 px-3.5 text-xs font-semibold text-fuchsia-400 opacity-70 dark:border-fuchsia-800 dark:text-fuchsia-500"
          >
            Payment
          </button>
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
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-400 px-3.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
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
      </div>
    </header>
  );
};
