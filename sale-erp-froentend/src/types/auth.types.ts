export interface LoginRequest {
  userName: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  userName?: string;
  organizationId?: number;
  organizationName?: string;
  organizationLogoUrl?: string | null;
  role?: string;
  permissions?: string[];
}

export interface JwtAuthPayload {
  organizationId?: number;
  role?: string;
  organizationName?: string;
  organizationLogoUrl?: string | null;
  permissions?: string[];
  userName?: string;
  userId?: number;
  sub?: string;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  accessToken: string;
  tokenType: string;
  userId: number;
  userName: string;
  organizationId: number;
  organizationName: string;
  organizationLogoUrl: string | null;
  role: string;
  permissions: string[];
  issuedAt: number | null;
  expiresAt: number | null;
}
