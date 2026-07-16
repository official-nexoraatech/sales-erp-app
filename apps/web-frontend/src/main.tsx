import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { Toaster, toast } from 'react-hot-toast';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
// Marketing-site display face only (--font-display) — headings on the public
// pages, the authenticated app keeps Inter everywhere.
import '@fontsource/lexend/500.css';
import '@fontsource/lexend/600.css';
import '@fontsource/lexend/700.css';
import App from './App.js';
import { ApiError } from './api/client.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { ConfirmProvider } from './context/ConfirmContext.js';
import './index.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // 401s are handled by the client.ts refresh-on-401 interceptor (silent retry
      // or redirect to /login) — toasting here would just be noise on top of that.
      if (error instanceof ApiError && error.statusCode === 401) return;
      toast.error(error instanceof Error ? error.message : 'Something went wrong loading data');
    },
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
          <Toaster
            // ERPPageHeader consistently places action buttons (Send/Accept/Convert/Confirm,
            // etc.) top-right of the content area — a top-right toast sits directly on top of
            // them for its whole visible duration, silently swallowing the next real click.
            // Found via live E2E testing: Send -> Accept in quick succession blocked every time.
            position="bottom-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: 'var(--surface-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
              },
              success: {
                iconTheme: { primary: 'var(--color-success)', secondary: 'var(--surface-card)' },
                style: { border: '1px solid var(--color-success-border)' },
              },
              error: {
                iconTheme: { primary: 'var(--color-danger)', secondary: 'var(--surface-card)' },
                style: { border: '1px solid var(--color-danger-border)' },
              },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
