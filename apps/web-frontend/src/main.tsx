import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
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
import { queryClient } from './lib/queryClient.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { ConfirmProvider } from './context/ConfirmContext.js';
import './index.css';

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

// CRM-ROADMAP Phase 3, Feature 4 (Mobile CRM) — registered after load so it never competes
// with the initial page render for bandwidth/CPU. Not supported (older browsers, some
// in-app webviews) just means no install prompt/offline shell — the app itself doesn't
// depend on this succeeding.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
