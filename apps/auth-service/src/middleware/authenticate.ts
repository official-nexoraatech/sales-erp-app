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

  // CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal, Finding 1): a CUSTOMER-role
  // portal JWT must never reach auth-service's own staff-only routes (session management can
  // revoke ANY session by numeric id — exactly the cross-service collision Finding 1 flagged).
  // Portal auth routes (portal-auth.routes.ts) are public and never gated by this middleware.
  if (request.auth.roles.includes('CUSTOMER')) {
    await reply.code(401).send({ error: 'Portal sessions cannot access staff endpoints' });
    return;
  }

  await assertTenantActive(request.auth.tenantId, request.auth.permissions);
}
