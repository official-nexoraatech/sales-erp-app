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
    await reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    });
    return;
  }

  try {
    request.auth = await verifyAccessToken(authHeader.slice(7));
  } catch {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return;
  }

  if (request.auth.roles.includes('CUSTOMER')) {
    await reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Portal sessions cannot access staff endpoints' },
    });
    return;
  }

  await assertTenantActive(request.auth.tenantId, request.auth.permissions);
}
