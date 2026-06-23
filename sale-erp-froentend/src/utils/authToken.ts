import type { AuthUser, JwtAuthPayload, LoginResponse } from '../types/auth.types';

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const decodeJwtPayload = (token: string): JwtAuthPayload | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(decodeBase64Url(payload)) as JwtAuthPayload;
  } catch {
    return null;
  }
};

export const isTokenExpired = (expiresAt: number | null | undefined) => {
  if (!expiresAt) return true;
  return Date.now() >= expiresAt;
};

export const authUserFromLoginResponse = (response: LoginResponse): AuthUser => {
  const payload = decodeJwtPayload(response.accessToken);
  const permissions = Array.isArray(payload?.permissions)
    ? payload.permissions
    : Array.isArray(response.permissions)
      ? response.permissions
      : [];
  const normalizedPermissions = [...new Set(
    permissions
      .filter((permission): permission is string => typeof permission === 'string')
      .map((permission) => permission.trim())
      .filter(Boolean)
  )];

  return {
    accessToken: response.accessToken,
    tokenType: response.tokenType || 'Bearer',
    userId: Number(payload?.userId ?? 0),
    userName: payload?.userName || response.userName || payload?.sub || '',
    organizationId: Number(payload?.organizationId ?? response.organizationId ?? 0),
    organizationName: payload?.organizationName || response.organizationName || '',
    organizationLogoUrl: payload?.organizationLogoUrl ?? response.organizationLogoUrl ?? null,
    role: payload?.role || response.role || '',
    permissions: normalizedPermissions,
    issuedAt: payload?.iat ? payload.iat * 1000 : null,
    expiresAt: payload?.exp ? payload.exp * 1000 : null,
  };
};
