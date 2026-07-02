import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';
export * from './schema/index.js';
export function createDatabaseClient(options) {
    const sql = postgres(options.url, {
        max: options.maxConnections ?? 10,
        idle_timeout: (options.idleTimeoutMs ?? 30_000) / 1000,
        connect_timeout: 10,
    });
    return drizzle(sql, { schema });
}
export function createReadReplicaClient(options) {
    const sql = postgres(options.url, {
        max: options.maxConnections ?? 20,
        idle_timeout: (options.idleTimeoutMs ?? 30_000) / 1000,
        connect_timeout: 10,
    });
    return drizzle(sql, { schema });
}
//# sourceMappingURL=index.js.map