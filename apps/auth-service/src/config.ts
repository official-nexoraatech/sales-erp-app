import { loadConfig } from '@erp/config';

export function loadAuthConfig() {
  const base = loadConfig('auth-service');
  return {
    ...base,
    port: parseInt(process.env['AUTH_SERVICE_PORT'] ?? '3010', 10),
    jwtIssuer: process.env['JWT_ISSUER'] ?? 'erp-auth-service',
    jwtAccessTokenTtl: parseInt(process.env['JWT_ACCESS_TOKEN_TTL_SECONDS'] ?? '900', 10),
    jwtRefreshTokenTtlDays: parseInt(process.env['JWT_REFRESH_TOKEN_TTL_DAYS'] ?? '7', 10),
    jwtPrivateKey: process.env['JWT_PRIVATE_KEY'] ?? '',
    jwtPublicKey: process.env['JWT_PUBLIC_KEY'] ?? '',
    loginRateLimitMax: parseInt(process.env['LOGIN_RATE_LIMIT_MAX'] ?? '10', 10),
    loginRateLimitWindowMs: parseInt(process.env['LOGIN_RATE_LIMIT_WINDOW_MS'] ?? '300000', 10),
    accountLockoutAttempts: parseInt(process.env['ACCOUNT_LOCKOUT_ATTEMPTS'] ?? '5', 10),
    accountLockoutDurationMs: parseInt(process.env['ACCOUNT_LOCKOUT_DURATION_MS'] ?? '900000', 10),
    passwordResetTokenTtlMs: parseInt(process.env['PASSWORD_RESET_TOKEN_TTL_MS'] ?? '3600000', 10),
    smtpFromAddress: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
  };
}

export type AuthConfig = ReturnType<typeof loadAuthConfig>;
