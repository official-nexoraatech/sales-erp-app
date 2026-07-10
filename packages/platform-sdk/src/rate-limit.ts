// Structural — avoids a hard dependency on fastify's types from this framework-agnostic SDK.
export interface RateLimitRequest {
  ip: string;
  auth?: { tenantId?: number };
}

export const RATE_LIMIT_DEFAULTS = {
  max: 200,
  timeWindow: '1 minute',
} as const;

// Default keyGenerator for @fastify/rate-limit: tenant-scoped once a request is
// authenticated, IP-scoped otherwise. Note: when registered as a global
// (onRequest-level) rate limiter, this runs before the `authenticate` preHandler
// populates `request.auth`, so global limiting is effectively IP-keyed — routes
// that need true per-tenant limiting should override `config.rateLimit.keyGenerator`
// at the route level (after auth has run).
export function tenantOrIpKeyGenerator(request: RateLimitRequest): string {
  return request.auth?.tenantId !== undefined ? `tenant:${request.auth.tenantId}` : request.ip;
}
