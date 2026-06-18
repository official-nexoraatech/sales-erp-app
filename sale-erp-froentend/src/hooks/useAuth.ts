import { useAuthStore } from '../store/authStore';

export const useAuth = () => {
  const { token, user, expiresAt, isAuthenticated, login, logout, isSessionValid, hasPermission } =
    useAuthStore();

  return {
    token,
    user,
    expiresAt,
    isAuthenticated,
    login,
    logout,
    isSessionValid,
    hasPermission,
  };
};
