import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { checkPermission } from '@erp/sdk';

export function requirePermission(permission: string): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    const result = checkPermission(auth, permission);
    if (result === 'unauthenticated') {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
      return;
    }
    if (result === 'forbidden') {
      await reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${permission}` } });
    }
  };
}

// Grants access if the caller holds ANY of the listed permissions — see sales-service's
// authorize.ts for the full rationale (checking a broader/legacy permission alongside a
// purpose-built one keeps existing roles working while making the new constant do something).
export function requireAnyPermission(permissions: string[]): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    const results = permissions.map((p) => checkPermission(auth, p));
    if (results.some((r) => r === 'unauthenticated')) {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
      return;
    }
    if (!results.some((r) => r === 'ok')) {
      await reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Missing permission: one of ${permissions.join(', ')}`,
        },
      });
    }
  };
}
