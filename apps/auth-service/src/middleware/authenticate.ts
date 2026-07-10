import type { FastifyRequest, FastifyReply } from 'fastify';
import { assertTenantActive } from '@erp/sdk';
import { verifyAccessToken, type AccessTokenPayload } from '../jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessTokenPayload & { userId: number };
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyAccessToken(token);
    request.auth = {
      ...payload,
      userId: parseInt(payload.sub, 10),
    };
  } catch {
    await reply.code(401).send({ error: 'Invalid or expired token' });
    return;
  }

  await assertTenantActive(request.auth.tenantId, request.auth.permissions);
}
