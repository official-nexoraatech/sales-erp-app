import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, assertTenantActive, type AuthPayload } from '@erp/sdk';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthPayload;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } });
    return;
  }

  try {
    request.auth = await verifyAccessToken(authHeader.slice(7));
  } catch {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return;
  }

  await assertTenantActive(request.auth.tenantId, request.auth.permissions);
}

// The native browser EventSource API cannot set an Authorization header, so the
// SSE stream accepts the same JWT as a `?token=` query param instead.
export async function authenticateStream(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = (request.query as { token?: string } | undefined)?.token;
  if (!token) {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing token query parameter' } });
    return;
  }

  try {
    request.auth = await verifyAccessToken(token);
  } catch {
    await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
  }
}
