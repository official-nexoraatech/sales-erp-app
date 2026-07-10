import { sql } from 'drizzle-orm';
import type { ErpDatabase } from './index.js';

/**
 * Checks Postgres streaming-replication lag on a replica connection via the
 * built-in pg_last_xact_replay_timestamp() function (no schema/migration needed).
 * Returns false (treat as unhealthy) on a connection error or when the function
 * returns NULL (not currently replicating), so callers degrade to the primary
 * rather than risk serving stale data silently.
 */
export async function isReplicaHealthy(replicaDb: ErpDatabase, maxLagMs = 5000): Promise<boolean> {
  try {
    const rows = (await replicaDb.execute(
      sql`SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 AS lag_ms`
    )) as unknown as Record<string, unknown>[];
    const lagMs = rows[0]?.['lag_ms'];
    if (lagMs === null || lagMs === undefined) return false;
    return Number(lagMs) <= maxLagMs;
  } catch {
    return false;
  }
}
