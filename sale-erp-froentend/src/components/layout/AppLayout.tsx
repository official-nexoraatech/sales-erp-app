import React, { useState } from 'react';
import { Sidebar } from './Sidebar';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-white">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        className="fixed left-3 top-3 z-30 rounded-full bg-[#25282d] p-2 text-white shadow-lg md:hidden"
        aria-label="Open menu"
      >
        <span className="block h-0.5 w-5 bg-current" />
        <span className="mt-1.5 block h-0.5 w-5 bg-current" />
        <span className="mt-1.5 block h-0.5 w-5 bg-current" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-gray-200">
        <main className="flex-1 overflow-y-auto bg-white">
          <div className="p-4 md:p-7">{children}</div>
        </main>
      </div>
    </div>
  );
};
