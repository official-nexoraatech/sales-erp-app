import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permissions?: string | string[];
  requireAll?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  permissions,
  requireAll = false,
}) => {
  const {
    token,
    expiresAt,
    isAuthenticated,
    isSessionValid,
    logout,
    hasAnyPermission,
    hasAllPermissions,
  } = useAuth();
  const sessionValid = isSessionValid();
  const requiredPermissions = permissions
    ? Array.isArray(permissions) ? permissions : [permissions]
    : [];

  React.useEffect(() => {
    if (token && !sessionValid) logout();
  }, [logout, sessionValid, token]);

  React.useEffect(() => {
    if (!token || !expiresAt) return undefined;
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      logout();
      return undefined;
    }
    const timeoutId = window.setTimeout(logout, delay);
    return () => window.clearTimeout(timeoutId);
  }, [expiresAt, logout, token]);

  if (!isAuthenticated || !sessionValid) {
    return <Navigate to="/login" replace />;
  }

  if (
    requiredPermissions.length > 0
    && !(requireAll
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions))
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
