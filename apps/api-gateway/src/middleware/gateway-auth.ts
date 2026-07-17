import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '@erp/sdk';

// Coarse-grained gate only — JWT signature/expiry check so malformed/expired tokens
// never reach a backend service. Fine-grained requirePermission() checks stay
// exclusively in each service (see PG-001 Architecture: gateway has no route-table
// visibility into per-route permission requirements).
const EXEMPT_PATHS = new Set([
  '/health',
  '/api/auth/auth/login',
  '/api/auth/auth/lookup-tenants',
  '/api/auth/auth/refresh',
  '/api/auth/auth/logout',
  '/api/auth/auth/forgot-password',
  '/api/auth/auth/reset-password',
  '/api/auth/auth/mfa/verify',
  '/api/tenant/public/signup',
  '/api/tenant/public/faqs',
]);

// A handful of genuinely unauthenticated routes carry a dynamic path segment (e.g. a
// one-time token), so they can't be listed as an exact string in EXEMPT_PATHS above.
const EXEMPT_PREFIXES = ['/api/report/unsubscribe/'];

// The native browser EventSource API cannot set an Authorization header, so SSE routes
// accept the JWT as a `?token=` query param instead (notification-service's own
// authenticateStream already handles this) — the gateway must recognize the same fallback
// for exactly these routes, or it 401s every SSE connection before notification-service ever
// sees it (found in live QA 2026-07-17: the stream 401'd on every page load).
const QUERY_TOKEN_PATHS = new Set(['/api/notification/notifications/stream']);

export async function gatewayAuthPreHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const path = request.url.split('?')[0];
  if (path !== undefined) {
    if (EXEMPT_PATHS.has(path)) return;
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
  }

  const authHeader = request.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  if (!token && path !== undefined && QUERY_TOKEN_PATHS.has(path)) {
    token = (request.query as { token?: string } | undefined)?.token;
  }
  if (!token) {
    void reply.code(401).send({
      error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid Authorization header' },
    });
    return;
  }

  try {
    // Signature/expiry check only — deliberately not propagating tenantId via a header.
    // Every downstream service independently re-verifies this same JWT and derives its
    // own tenantId from it (see PG-001 Architecture note above); a client can reach most
    // services directly, bypassing this gateway entirely (see PG-010's frontend-bypass
    // finding), so a service ever trusting an x-tenant-id header instead of its own JWT
    // verification would be spoofable. This call's only job is to reject bad tokens early.
    await verifyAccessToken(token);
    const correlationId = (request as unknown as { correlationId?: string }).correlationId;
    if (correlationId) {
      request.headers['x-correlation-id'] = correlationId;
    }
  } catch {
    void reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired access token' } });
  }
}
