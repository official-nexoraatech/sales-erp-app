import { requireEnv } from '@erp/config';

export interface TenantServiceConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  kafkaBrokers: string[];
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;
  elasticsearchUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpFromAddress: string;
  jwtPublicKey: string;
}

export function loadTenantConfig(): TenantServiceConfig {
  return {
    port: parseInt(process.env['TENANT_SERVICE_PORT'] ?? '3011', 10),
    databaseUrl: requireEnv('DATABASE_URL'),
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6380',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:29092').split(','),
    minioEndpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
    minioAccessKey: process.env['MINIO_ACCESS_KEY'] ?? 'erp_minio',
    minioSecretKey: process.env['MINIO_SECRET_KEY'] ?? 'erp_minio_secret',
    minioBucket: process.env['MINIO_BUCKET'] ?? 'erp-storage',
    elasticsearchUrl: process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200',
    smtpHost: process.env['SMTP_HOST'] ?? 'localhost',
    smtpPort: parseInt(process.env['SMTP_PORT'] ?? '1025', 10),
    smtpFromAddress: process.env['SMTP_FROM_ADDRESS'] ?? 'noreply@erp.local',
    jwtPublicKey: process.env['JWT_PUBLIC_KEY'] ?? '',
  };
}
