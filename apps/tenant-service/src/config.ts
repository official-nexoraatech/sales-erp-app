import { loadConfigWithSecrets, requireEnv } from '@erp/config';

export interface TenantServiceConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  kafkaBrokers: string[];
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioUseSSL: boolean;
  minioBucket: string;
  searchServiceUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpFromAddress: string;
  jwtPublicKey: string;
  signupRateLimitMax: number;
  signupRateLimitWindowMs: number;
  demoRequestRateLimitMax: number;
  demoRequestRateLimitWindowMs: number;
}

export async function loadTenantConfig(): Promise<TenantServiceConfig> {
  // PG-027 Session 2: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET are payment
  // credentials — same trust tier as FIELD_ENCRYPTION_KEY (auth-service) and DB/JWT secrets, so
  // they go through the same Vault-in-production, env-var-in-dev/test path via extraSecrets,
  // not a plain process.env read with no Vault sourcing. Written back into process.env by
  // loadConfigWithSecrets itself; billing-internal.routes.ts/billing-webhook.routes.ts's own
  // process.env['RAZORPAY_...'] reads pick these up unchanged in both environments.
  const base = await loadConfigWithSecrets('tenant-service', {
    extraSecrets: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'],
  });
  return {
    port: parseInt(process.env['TENANT_SERVICE_PORT'] ?? '3011', 10),
    databaseUrl: base.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    minioEndpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
    minioAccessKey: base.minioAccessKey,
    minioSecretKey: base.minioSecretKey,
    minioUseSSL: process.env['MINIO_USE_SSL'] === 'true',
    minioBucket: process.env['MINIO_BUCKET'] ?? 'erp-storage',
    searchServiceUrl: process.env['SEARCH_SERVICE_URL'] ?? 'http://localhost:3017',
    smtpHost: process.env['SMTP_HOST'] ?? 'localhost',
    smtpPort: parseInt(process.env['SMTP_PORT'] ?? '1025', 10),
    smtpFromAddress: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
    // F20: previously defaulted to '' — a missing key silently booted the service, only
    // surfacing as an opaque auth failure on the first real request (platform-sdk's
    // verifyAccessToken throwing deep inside request handling) rather than an immediate,
    // obvious boot-time error. requireEnv() fails fast instead.
    jwtPublicKey: requireEnv('JWT_PUBLIC_KEY'),
    signupRateLimitMax: parseInt(process.env['SIGNUP_RATE_LIMIT_MAX'] ?? '5', 10),
    signupRateLimitWindowMs: parseInt(process.env['SIGNUP_RATE_LIMIT_WINDOW_MS'] ?? '3600000', 10),
    demoRequestRateLimitMax: parseInt(process.env['DEMO_REQUEST_RATE_LIMIT_MAX'] ?? '5', 10),
    demoRequestRateLimitWindowMs: parseInt(
      process.env['DEMO_REQUEST_RATE_LIMIT_WINDOW_MS'] ?? '3600000',
      10
    ),
  };
}
