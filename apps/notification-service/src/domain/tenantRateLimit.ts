// CP-9 follow-up (R14): notification-service's global @fastify/rate-limit plugin keys by
// tenant when `request.auth.tenantId` is populated (see packages/platform-sdk/src/rate-limit.ts's
// tenantOrIpKeyGenerator), but /notifications/send-raw-internal is authenticated via
// x-internal-key, not a JWT — request.auth is never populated for it, so it silently falls back
// to IP-keyed limiting. Since every tenant's campaign sends route through the same sales-service
// host calling this one internal endpoint, that meant the entire platform's campaign-sending
// traffic — across every tenant combined — shared one 200-request/minute budget. A live
// measurement (300 real recipients) reproduced this directly: 100 of 300 failed, matching the
// limit exactly.
//
// This module is a small, purpose-built, genuinely-per-tenant limiter for that one internal
// path — a fixed 60s window counter in Redis, with the ceiling configurable per tenant via
// tenant_communication_settings.notification_rate_limit_per_minute (null = platform default).
import type Redis from 'ioredis';

export const DEFAULT_NOTIFICATION_RATE_LIMIT_PER_MINUTE = 200;
const WINDOW_SECONDS = 60;

export interface TenantRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
}

/**
 * Atomically increments the current minute-bucket counter for a tenant and reports whether
 * this call is within the configured limit. Fails open (allowed: true) if Redis is unreachable —
 * a rate limiter that itself takes the platform down on a Redis blip is worse than temporarily
 * not rate-limiting, matching this codebase's existing fail-open convention for non-critical
 * infra (see the circuit-breaker pattern's fallback behavior in sales-service).
 */
export async function checkTenantNotificationRateLimit(
  redis: Redis,
  tenantId: number,
  limit: number
): Promise<TenantRateLimitResult> {
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:notif:${tenantId}:${bucket}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: true, limit, remaining: limit };
  }
}
