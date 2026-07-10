import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import './index.css';
import POSScreen from './POSScreen.js';
import LoginScreen from './LoginScreen.js';
import LookupScreen from './LookupScreen.js';
import AccountSuspendedScreen from './AccountSuspendedScreen.js';
import { getAccessToken } from './auth.js';
import { ThemeProvider, useTheme } from './context/ThemeContext.js';
import TenantThemeSync from './components/pos/TenantThemeSync.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RequireAuth({ children }: { children: ReactElement }) {
  return getAccessToken() ? children : <Navigate to="/login" replace />;
}

// react-hot-toast's Toaster doesn't pick up CSS custom properties on its own (it's
// rendered in a portal outside the token cascade context) — style it explicitly per
// theme so toasts don't stay light-on-dark when the app is in dark mode.
function ThemedToaster() {
  const { isDark } = useTheme();
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: isDark ? '#1e293b' : '#ffffff',
          color: isDark ? '#f1f5f9' : '#111827',
          border: `1px solid ${isDark ? '#334155' : '#e5e7eb'}`,
        },
      }}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/account-suspended" element={<AccountSuspendedScreen />} />
            <Route path="/" element={<RequireAuth><POSScreen /></RequireAuth>} />
            <Route path="/lookup" element={<RequireAuth><LookupScreen /></RequireAuth>} />
            <Route path="*" element={<RequireAuth><POSScreen /></RequireAuth>} />
          </Routes>
          <ThemedToaster />
          <TenantThemeSync />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
