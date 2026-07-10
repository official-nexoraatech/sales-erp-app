import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';
export type { PostgresJsDatabase };
export { isReplicaHealthy } from './replica-health.js';
export { ReplicaRouter, type ReplicaRouterOptions } from './replica-router.js';

export type ErpDatabase = PostgresJsDatabase<typeof schema>;

export interface DatabaseClientOptions {
  url: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
}

export function createDatabaseClient(options: DatabaseClientOptions): ErpDatabase {
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 10,
    idle_timeout: (options.idleTimeoutMs ?? 30_000) / 1000,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}

export function createReadReplicaClient(options: DatabaseClientOptions): ErpDatabase {
  const sql = postgres(options.url, {
    max: options.maxConnections ?? 20,
    idle_timeout: (options.idleTimeoutMs ?? 30_000) / 1000,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}
