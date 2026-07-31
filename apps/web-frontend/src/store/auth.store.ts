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
  // Neither token is persisted (see partialize below) — both optional since a rehydrated
  // session never has them. accessToken is always repopulated by AuthBootstrap (App.tsx)
  // before the UI can reach stopImpersonation(); refreshToken is never read anymore now
  // that refresh goes via the httpOnly cookie instead.
  accessToken?: string;
  refreshToken?: string;
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
      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          realSession: null,
          impersonationExpiresAt: null,
        }),
      hasPermission: (permission: string) => {
        const { user } = get();
        if (!user) return false;
        return user.permissions.includes(permission);
      },
      startImpersonation: (accessToken, targetUser, expiresAt) => {
        const {
          user,
          accessToken: currentAccessToken,
          refreshToken: currentRefreshToken,
          realSession,
        } = get();
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
        if (!realSession.accessToken) {
          // A rehydrated-but-not-yet-bootstrapped realSession has no token (see partialize
          // above) — AuthBootstrap (App.tsx) always collapses this before the UI can reach
          // here, so this is a defensive fallback only, not an expected path.
          set({ realSession: null, impersonationExpiresAt: null });
          return;
        }
        set({
          user: realSession.user,
          accessToken: realSession.accessToken,
          refreshToken: realSession.refreshToken ?? null,
          realSession: null,
          impersonationExpiresAt: null,
        });
      },
    }),
    {
      name: 'erp-auth',
      // refreshToken is deliberately excluded (both here and inside realSession) — it
      // now lives only in the httpOnly refresh_token cookie set by auth-service, never
      // in localStorage, so an XSS payload reading localStorage can no longer steal a
      // 7-day-lived credential. The in-memory refreshToken field is kept only so
      // setTokens()'s existing call sites don't need to change; nothing reads it anymore
      // (see performRefresh in api/client.ts, which refreshes via the cookie instead).
      //
      // accessToken (both here and inside realSession) is excluded for the same reason —
      // it's the more consequential of the two tokens to keep out of localStorage, since
      // it's what every request actually authenticates with, not just a rarely-used
      // refresh credential. It now lives in memory only; App.tsx's AuthBootstrap silently
      // re-derives it from the httpOnly refresh cookie on every page load via performRefresh,
      // so a reload no longer forces a re-login (see WEB-FRONTEND-AUDIT-2026-07-24.md, High #6).
      partialize: (s) => ({
        user: s.user,
        realSession: s.realSession ? { user: s.realSession.user } : null,
        impersonationExpiresAt: s.impersonationExpiresAt,
      }),
    }
  )
);
