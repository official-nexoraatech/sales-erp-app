import React, { useEffect, useState } from 'react';
import { TRANSLATION_RESET_EVENT } from '../../hooks/usePageTranslation';
import { Sidebar } from './Sidebar';
import { AppHeader } from './AppHeader';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  );
  const [translationResetKey, setTranslationResetKey] = useState(0);

  useEffect(() => {
    const repaintLayout = () => setTranslationResetKey((current) => current + 1);
    window.addEventListener(TRANSLATION_RESET_EVENT, repaintLayout);
    return () => window.removeEventListener(TRANSLATION_RESET_EVENT, repaintLayout);
  }, []);

  const handleToggleCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  };

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-900">
      <Sidebar
        key={`sidebar-${translationResetKey}`}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
      />

      {/* Mobile hamburger — matches sidebar chrome color */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="fixed left-3 top-3 z-30 rounded-lg border border-slate-200 bg-white p-2 text-blue-600 shadow-md transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-400 dark:hover:bg-slate-700 md:hidden"
        aria-label="Open menu"
      >
        <span className="block h-0.5 w-5 bg-current" />
        <span className="mt-1.5 block h-0.5 w-5 bg-current" />
        <span className="mt-1.5 block h-0.5 w-5 bg-current" />
      </button>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader />

        {/* Main content — slate-900 is slightly deeper than the sidebar/header chrome (slate-800) */}
        <main
          key={`content-${translationResetKey}`}
          className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-900"
        >
          <div className="min-h-full p-4 pb-8 md:p-5 md:pb-10">
            {children}
          </div>
        </main>

        {/* Footer — same slate-800 as sidebar and header for unified chrome */}
        <footer className="flex h-8 shrink-0 items-center justify-center border-t border-slate-200 bg-white px-4 text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500">
          Copyright &copy; Texmintra &mdash; {new Date().getFullYear()} (v2.4)
        </footer>
      </div>
    </div>
  );
};
