import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { queryClient } from './app/queryClient';
import { router } from './app/router';
import { ThemeProvider } from './contexts/ThemeContext';
import './index.css';

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster
          position="top-right"
          toastOptions={{
            className: 'dark:!bg-slate-800 dark:!text-slate-100 dark:!border-slate-700',
            style: { borderRadius: '0.5rem' },
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
