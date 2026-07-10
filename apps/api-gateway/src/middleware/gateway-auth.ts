import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from '@erp/sdk';

// Coarse-grained gate only — JWT signature/expiry check so malformed/expired tokens
// never reach a backend service. Fine-grained requirePermission() checks stay
// exclusively in each service (see PG-001 Architecture: gateway has no route-table
// visibility into per-route permission requirements).
const EXEMPT_PATHS = new Set(['/health', '/api/auth/auth/login', '/api/auth/auth/refresh']);

export async function gatewayAuthPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = request.url.split('?')[0];
  if (path !== undefined && EXEMPT_PATHS.has(path)) return;

  const authHeader = request.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
  if (!token) {
    void reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid Authorization header' } });
    return;
  }

  try {
    const auth = await verifyAccessToken(token);
    // request.headers is the same object as request.raw.headers, so mutating it here
    // is what @fastify/http-proxy forwards upstream.
    request.headers['x-tenant-id'] = String(auth.tenantId);
    const correlationId = (request as unknown as { correlationId?: string }).correlationId;
    if (correlationId) {
      request.headers['x-correlation-id'] = correlationId;
    }
  } catch {
    void reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired access token' } });
  }
}
