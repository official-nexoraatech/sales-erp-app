import { VaultClient } from './vault.js';

export { VaultClient, loadSecret } from './vault.js';
export type { VaultClientOptions } from './vault.js';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  serviceName: string;
  databaseUrl: string;
  databaseReplicaUrl: string;
  redisUrl: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioUseSSL: boolean;
  minioBucket: string;
  elasticsearchUrl: string;
  jwtPublicKey: string;
  jwtPrivateKey: string;
  jwtAccessTokenTtl: number;
  jwtRefreshTokenTtl: number;
  vaultAddr: string;
  vaultToken: string;
  otlpEndpoint: string;
  logLevel: string;
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (val === undefined || val === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

export function loadConfig(serviceName: string): AppConfig {
  return {
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    serviceName,
    databaseUrl:
      process.env['DATABASE_URL'] ?? 'postgresql://erp:erp@localhost:5432/erp',
    databaseReplicaUrl:
      process.env['DATABASE_REPLICA_URL'] ?? process.env['DATABASE_URL'] ?? 'postgresql://erp:erp@localhost:5433/erp',
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    kafkaBrokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
    kafkaClientId: process.env['KAFKA_CLIENT_ID'] ?? serviceName,
    minioEndpoint: process.env['MINIO_ENDPOINT'] ?? 'localhost:9000',
    minioAccessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
    minioSecretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
    minioUseSSL: process.env['MINIO_USE_SSL'] === 'true',
    minioBucket: process.env['MINIO_BUCKET'] ?? 'erp-local',
    elasticsearchUrl: process.env['ELASTICSEARCH_URL'] ?? 'http://localhost:9200',
    jwtPublicKey: process.env['JWT_PUBLIC_KEY'] ?? '',
    jwtPrivateKey: process.env['JWT_PRIVATE_KEY'] ?? '',
    jwtAccessTokenTtl: parseInt(process.env['JWT_ACCESS_TOKEN_TTL'] ?? '900', 10),
    jwtRefreshTokenTtl: parseInt(process.env['JWT_REFRESH_TOKEN_TTL'] ?? '604800', 10),
    vaultAddr: process.env['VAULT_ADDR'] ?? 'http://localhost:8200',
    vaultToken: process.env['VAULT_TOKEN'] ?? 'dev-root-token',
    otlpEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318',
    logLevel: process.env['LOG_LEVEL'] ?? 'info',
  };
}

// Priority-1 secrets (PG-004): highest blast-radius secrets, migrated first.
// Vault path per service: secret/data/erp/<serviceName>; key names match the
// env vars they replace so the mapping stays self-documenting.
const PRIORITY_SECRETS: Array<{ envKey: string; configField: 'databaseUrl' | 'databaseReplicaUrl' | 'jwtPrivateKey' }> = [
  { envKey: 'DATABASE_URL', configField: 'databaseUrl' },
  { envKey: 'DATABASE_REPLICA_URL', configField: 'databaseReplicaUrl' },
  { envKey: 'JWT_PRIVATE_KEY', configField: 'jwtPrivateKey' },
];

export interface LoadConfigWithSecretsOptions {
  /**
   * Extra service-specific secrets (e.g. FIELD_ENCRYPTION_KEY) that aren't
   * fields on AppConfig. Fetched from the same erp/<serviceName> Vault path
   * and written back into process.env under the same key, so existing ad
   * hoc requireEnv(envKey) call sites pick up the Vault-sourced value with
   * no changes at the call site.
   */
  extraSecrets?: string[];
}

/**
 * Like loadConfig(), but in production sources the priority-1 secrets
 * (DB credentials, JWT signing key) from Vault instead of process.env,
 * failing fast if Vault or a required secret is unavailable.
 *
 * In development/test, behaves identically to loadConfig() — no Vault
 * dependency for local dev.
 */
export async function loadConfigWithSecrets(
  serviceName: string,
  options?: LoadConfigWithSecretsOptions,
): Promise<AppConfig> {
  const config = loadConfig(serviceName);
  if (config.nodeEnv !== 'production') {
    return config;
  }

  // Read directly from process.env rather than config.vaultAddr/vaultToken:
  // loadConfig() defaults those to the Vault dev-mode address and root token,
  // which must never be used in production (see Security section of PG-004).
  const vaultAddr = process.env['VAULT_ADDR'];
  const vaultToken = process.env['VAULT_TOKEN'];
  if (!vaultAddr || !vaultToken) {
    throw new Error(
      `VAULT_ADDR and VAULT_TOKEN are required in production (service "${serviceName}")`,
    );
  }

  const vault = new VaultClient({ addr: vaultAddr, token: vaultToken });
  const resolved = { ...config };

  for (const { envKey, configField } of PRIORITY_SECRETS) {
    try {
      resolved[configField] = await vault.getSecret(`erp/${serviceName}`, envKey);
    } catch (err) {
      throw new Error(
        `Failed to load required secret "${envKey}" from Vault for service "${serviceName}": ${(err as Error).message}`,
      );
    }
  }

  for (const envKey of options?.extraSecrets ?? []) {
    try {
      process.env[envKey] = await vault.getSecret(`erp/${serviceName}`, envKey);
    } catch (err) {
      throw new Error(
        `Failed to load required secret "${envKey}" from Vault for service "${serviceName}": ${(err as Error).message}`,
      );
    }
  }

  return resolved;
}
