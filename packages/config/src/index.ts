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
