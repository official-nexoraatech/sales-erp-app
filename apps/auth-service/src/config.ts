import { loadConfigWithSecrets } from '@erp/config';

export async function loadAuthConfig() {
  // jwtPrivateKey/jwtPublicKey come from `base` (Vault-sourced in production
  // via loadConfigWithSecrets, env-var in dev/test) — don't re-read them from
  // process.env here, that would clobber the Vault-sourced value in prod.
  const base = await loadConfigWithSecrets('auth-service', {
    extraSecrets: ['FIELD_ENCRYPTION_KEY'],
  });
  return {
    ...base,
    port: parseInt(process.env['AUTH_SERVICE_PORT'] ?? '3010', 10),
    jwtIssuer: process.env['JWT_ISSUER'] ?? 'erp-auth-service',
    jwtAccessTokenTtl: parseInt(process.env['JWT_ACCESS_TOKEN_TTL_SECONDS'] ?? '900', 10),
    jwtRefreshTokenTtlDays: parseInt(process.env['JWT_REFRESH_TOKEN_TTL_DAYS'] ?? '7', 10),
    loginRateLimitMax: parseInt(process.env['LOGIN_RATE_LIMIT_MAX'] ?? '10', 10),
    loginRateLimitWindowMs: parseInt(process.env['LOGIN_RATE_LIMIT_WINDOW_MS'] ?? '300000', 10),
    forgotPasswordRateLimitMax: parseInt(process.env['FORGOT_PASSWORD_RATE_LIMIT_MAX'] ?? '5', 10),
    forgotPasswordRateLimitWindowMs: parseInt(
      process.env['FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS'] ?? '900000',
      10
    ),
    lookupTenantsRateLimitMax: parseInt(process.env['LOOKUP_TENANTS_RATE_LIMIT_MAX'] ?? '20', 10),
    lookupTenantsRateLimitWindowMs: parseInt(
      process.env['LOOKUP_TENANTS_RATE_LIMIT_WINDOW_MS'] ?? '300000',
      10
    ),
    accountLockoutAttempts: parseInt(process.env['ACCOUNT_LOCKOUT_ATTEMPTS'] ?? '5', 10),
    accountLockoutDurationMs: parseInt(process.env['ACCOUNT_LOCKOUT_DURATION_MS'] ?? '900000', 10),
    ipLoginFailThreshold: parseInt(process.env['IP_LOGIN_FAIL_THRESHOLD'] ?? '5', 10),
    ipLoginFailWindowSeconds: parseInt(process.env['IP_LOGIN_FAIL_WINDOW_SECONDS'] ?? '600', 10),
    ipBlockDurationMs: parseInt(process.env['IP_BLOCK_DURATION_MS'] ?? '3600000', 10),
    passwordResetTokenTtlMs: parseInt(process.env['PASSWORD_RESET_TOKEN_TTL_MS'] ?? '3600000', 10),
    frontendUrl: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
    smtpFromAddress: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
    // extraSecrets above writes the Vault-sourced value back into
    // process.env in production; this line is unchanged from before and
    // works identically in dev/test (env var) and production (Vault).
    fieldEncryptionKey: process.env['FIELD_ENCRYPTION_KEY'] ?? '',
  };
}

export type AuthConfig = Awaited<ReturnType<typeof loadAuthConfig>>;
