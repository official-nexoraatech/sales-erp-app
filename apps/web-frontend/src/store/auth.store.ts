import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: number;
  tenantId: number;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  permissions: string[];
  branchIds: number[];
  totpEnabled?: boolean;
}

// The admin's own session, stashed while an impersonation token is active — lets
// "stop impersonating" restore access without a re-login (see startImpersonation).
interface RealSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  realSession: RealSession | null;
  impersonationExpiresAt: number | null;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  startImpersonation: (accessToken: string, targetUser: AuthUser, expiresAt: number) => void;
  stopImpersonation: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      realSession: null,
      impersonationExpiresAt: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null, realSession: null, impersonationExpiresAt: null }),
      hasPermission: (permission: string) => {
        const { user } = get();
        if (!user) return false;
        return user.permissions.includes(permission);
      },
      startImpersonation: (accessToken, targetUser, expiresAt) => {
        const { user, accessToken: currentAccessToken, refreshToken: currentRefreshToken, realSession } = get();
        // Ignore nested impersonation attempts and refuse to start without a real session to return to.
        if (realSession || !user || !currentAccessToken || !currentRefreshToken) return;
        set({
          realSession: { user, accessToken: currentAccessToken, refreshToken: currentRefreshToken },
          user: targetUser,
          accessToken,
          impersonationExpiresAt: expiresAt,
        });
      },
      stopImpersonation: () => {
        const { realSession } = get();
        if (!realSession) return;
        set({
          user: realSession.user,
          accessToken: realSession.accessToken,
          refreshToken: realSession.refreshToken,
          realSession: null,
          impersonationExpiresAt: null,
        });
      },
    }),
    {
      name: 'erp-auth',
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
        realSession: s.realSession,
        impersonationExpiresAt: s.impersonationExpiresAt,
      }),
    }
  )
);
