import { type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';
export * from './schema/index.js';
export type { PostgresJsDatabase };
export type ErpDatabase = PostgresJsDatabase<typeof schema>;
export interface DatabaseClientOptions {
    url: string;
    maxConnections?: number;
    idleTimeoutMs?: number;
}
export declare function createDatabaseClient(options: DatabaseClientOptions): ErpDatabase;
export declare function createReadReplicaClient(options: DatabaseClientOptions): ErpDatabase;
//# sourceMappingURL=index.d.ts.map