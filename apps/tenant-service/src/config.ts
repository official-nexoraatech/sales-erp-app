import { loadConfigWithSecrets } from '@erp/config';

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
  elasticsearchUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpFromAddress: string;
  jwtPublicKey: string;
  signupRateLimitMax: number;
  signupRateLimitWindowMs: number;
}

export async function loadTenantConfig(): Promise<TenantServiceConfig> {
  const base = await loadConfigWithSecrets('tenant-service');
  return {
    port: parseInt(process.env['TENANT_SERVICE_PORT'] ?? '3011', 10),
    databaseUrl: base.databaseUrl,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    minioEndpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
    minioAccessKey: process.env['MINIO_ACCESS_KEY'] ?? 'erp_minio',
    minioSecretKey: process.env['MINIO_SECRET_KEY'] ?? 'erp_minio_secret',
    minioUseSSL: process.env['MINIO_USE_SSL'] === 'true',
    minioBucket: process.env['MINIO_BUCKET'] ?? 'erp-storage',
    elasticsearchUrl: process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200',
    smtpHost: process.env['SMTP_HOST'] ?? 'localhost',
    smtpPort: parseInt(process.env['SMTP_PORT'] ?? '1025', 10),
    smtpFromAddress: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
    jwtPublicKey: process.env['JWT_PUBLIC_KEY'] ?? '',
    signupRateLimitMax: parseInt(process.env['SIGNUP_RATE_LIMIT_MAX'] ?? '5', 10),
    signupRateLimitWindowMs: parseInt(process.env['SIGNUP_RATE_LIMIT_WINDOW_MS'] ?? '3600000', 10),
  };
}
