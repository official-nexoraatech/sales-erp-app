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
    <div className="flex h-screen bg-[#f7f9fc] dark:bg-[#0f172a]">
      <Sidebar
        key={`sidebar-${translationResetKey}`}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
      />
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="fixed left-3 top-3 z-30 rounded-lg border border-[#dbe7f3] bg-white p-2 text-[#1684ed] shadow-md md:hidden"
        aria-label="Open menu"
      >
        <span className="block h-0.5 w-5 bg-current" />
        <span className="mt-1.5 block h-0.5 w-5 bg-current" />
        <span className="mt-1.5 block h-0.5 w-5 bg-current" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main key={`content-${translationResetKey}`} className="flex-1 overflow-y-auto bg-[#f7f9fc] dark:bg-[#0f172a]">
          <div className="min-h-full p-4 pb-8 md:p-5 md:pb-8">{children}</div>
        </main>
        <footer className="flex h-8 shrink-0 items-center justify-center border-t border-indigo-100 bg-white px-4 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-[#111827] dark:text-slate-400">
          Copyright &copy; Texmintra - {new Date().getFullYear()} (v2.4)
        </footer>
      </div>
    </div>
  );
};
