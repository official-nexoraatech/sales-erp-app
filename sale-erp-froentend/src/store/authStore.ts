import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { AuthUser } from '../types/auth.types';
import { isTokenExpired } from '../utils/authToken';

const isSuperAdmin = (role?: string) => role?.trim().toLowerCase() === 'super admin';

interface AuthStore {
  token: string | null;
  user: AuthUser | null;
  expiresAt: number | null;
  isAuthenticated: boolean;
  login: (user: AuthUser) => void;
  logout: () => void;
  isSessionValid: () => boolean;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
}

const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set, get) => ({
        token: null,
        user: null,
        expiresAt: null,
        isAuthenticated: false,

        login: (user: AuthUser) => {
          localStorage.setItem('authToken', user.accessToken);
          localStorage.setItem('authUser', JSON.stringify(user));
          set({
            token: user.accessToken,
            user,
            expiresAt: user.expiresAt,
            isAuthenticated: !isTokenExpired(user.expiresAt),
          });
        },

        logout: () => {
          localStorage.removeItem('authToken');
          localStorage.removeItem('authUser');
          set({
            token: null,
            user: null,
            expiresAt: null,
            isAuthenticated: false,
          });
        },

        isSessionValid: () => {
          const { token, user, expiresAt } = get();
          return !!token && !!user && !isTokenExpired(expiresAt ?? user.expiresAt);
        },

        hasPermission: (permission: string) => {
          const { user, isSessionValid } = get();
          if (!isSessionValid()) return false;
          if (isSuperAdmin(user?.role)) return true;
          return user?.permissions?.includes(permission) || false;
        },

        hasAnyPermission: (permissions: string[]) => {
          const { user, isSessionValid } = get();
          if (!isSessionValid()) return false;
          if (isSuperAdmin(user?.role)) return true;
          return permissions.some((permission) => user?.permissions?.includes(permission));
        },

        hasAllPermissions: (permissions: string[]) => {
          const { user, isSessionValid } = get();
          if (!isSessionValid()) return false;
          if (isSuperAdmin(user?.role)) return true;
          return permissions.every((permission) => user?.permissions?.includes(permission));
        },
      }),
      {
        name: 'auth-storage',
        partialize: (state) => ({
          token: state.token,
          user: state.user,
          expiresAt: state.expiresAt,
          isAuthenticated: state.isAuthenticated,
        }),
      }
    )
  )
);

export { useAuthStore };
