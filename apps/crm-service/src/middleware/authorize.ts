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

// Grants access if the caller holds ANY of the listed permissions. Used where a route
// currently gates on a broader/adjacent permission (e.g. INVOICE_VIEW) for historical reasons
// but a purpose-built constant also exists (e.g. QUOTATION_VIEW) — checking both keeps every
// role's current access working while making the purpose-built constant actually do something,
// instead of silently replacing the check and risking revoking access from a role that only
// has the broader one.
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
