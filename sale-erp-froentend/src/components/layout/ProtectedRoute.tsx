import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { token, expiresAt, isAuthenticated, isSessionValid, logout } = useAuth();
  const sessionValid = isSessionValid();

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

  return <>{children}</>;
};
