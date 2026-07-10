import type { Redis } from 'ioredis';
import { and, eq, gt } from 'drizzle-orm';
import { blockedIps, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import type { AuthConfig } from '../config.js';
import { inetParam } from '../db-helpers.js';

export interface IpBlockStatus {
  blocked: boolean;
  retryAfterSeconds?: number;
}

export async function checkIpBlocked(db: ErpDatabase, ip: string): Promise<IpBlockStatus> {
  const now = new Date();
  const [blockedRow] = await db
    .select()
    .from(blockedIps)
    .where(and(eq(blockedIps.ipAddress, inetParam(ip)), gt(blockedIps.blockedUntil, now)))
    .limit(1);

  if (!blockedRow) return { blocked: false };

  return {
    blocked: true,
    retryAfterSeconds: Math.ceil((blockedRow.blockedUntil.getTime() - now.getTime()) / 1000),
  };
}

export async function recordFailedLoginAndMaybeBlock(
  db: ErpDatabase,
  redis: Redis,
  ip: string,
  tenantId: number,
  config: AuthConfig
): Promise<void> {
  const key = `login_fail:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, config.ipLoginFailWindowSeconds);
  }

  if (count < config.ipLoginFailThreshold) return;

  const blockedUntil = new Date(Date.now() + config.ipBlockDurationMs);

  await db
    .insert(blockedIps)
    .values({ ipAddress: inetParam(ip), blockedUntil, reason: 'BRUTE_FORCE_IP' })
    .onConflictDoUpdate({
      target: blockedIps.ipAddress,
      set: { blockedUntil, reason: 'BRUTE_FORCE_IP' },
    });

  await db.insert(securityAuditLog).values({
    tenantId,
    actorId: 0,
    action: 'SUSPICIOUS_LOGIN',
    ipAddress: inetParam(ip),
    details: { failedAttempts: count, windowSeconds: config.ipLoginFailWindowSeconds },
  });

  await redis.del(key);
}
