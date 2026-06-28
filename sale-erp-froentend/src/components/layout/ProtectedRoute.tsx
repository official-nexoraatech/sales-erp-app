import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getDefaultAuthorizedPath } from '../../auth/featurePermissions';
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
    user,
    expiresAt,
    isAuthenticated,
    isSessionValid,
    logout,
    hasAnyPermission,
    hasAllPermissions,
  } = useAuth();
  const location = useLocation();
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
    const fallbackPath = getDefaultAuthorizedPath(user?.permissions, user?.role);

    if (fallbackPath !== location.pathname) {
      return <Navigate to={fallbackPath} replace />;
    }

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
          Your account does not have permission to access this page.
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
