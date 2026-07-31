import { QueryClient, QueryCache } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ApiError } from '../api/client.js';

// A standalone module (rather than declaring this inline in main.tsx) so non-component
// code — api/client.ts's automatic stop-impersonation-on-401 path in particular — can
// import the same singleton and clear it, not just components reachable via useQueryClient().
export const queryClient = new QueryClient({
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
