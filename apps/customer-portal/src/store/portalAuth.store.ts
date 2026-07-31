import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PortalCustomer {
  id: number;
  tenantId: number;
  email: string;
  displayName: string;
  mustResetPassword: boolean;
}

interface PortalAuthState {
  customer: PortalCustomer | null;
  accessToken: string | null;
  setSession: (accessToken: string, customer: PortalCustomer) => void;
  setAccessToken: (accessToken: string) => void;
  logout: () => void;
}

// Deliberately its own store, own persist key ('customer-portal-auth') — never shared with
// web-frontend's useAuthStore ('erp-auth'), same reasoning as this app being a fully separate
// Vite app rather than a route-tree bolted onto web-frontend (see the approved plan's frontend
// precedent note). accessToken is NOT persisted, same reasoning as web-frontend's own
// auth.store.ts: it lives in memory only and is re-derived from the httpOnly
// portal_refresh_token cookie on every reload via performPortalRefresh (see api/portalApiClient.ts).
export const usePortalAuthStore = create<PortalAuthState>()(
  persist(
    (set) => ({
      customer: null,
      accessToken: null,
      setSession: (accessToken, customer) => set({ accessToken, customer }),
      setAccessToken: (accessToken) => set({ accessToken }),
      logout: () => set({ customer: null, accessToken: null }),
    }),
    {
      name: 'customer-portal-auth',
      partialize: (s) => ({ customer: s.customer }),
    }
  )
);
