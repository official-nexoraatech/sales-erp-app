import type { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';
import type { Permission } from '@erp/types';

// Higher-order hook factory: requirePermission('INVOICE_CREATE')
export function requirePermission(permission: Permission): RouteHandlerMethod {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    if (!auth) {
      await reply.code(401).send({ error: 'Unauthenticated' });
      return;
    }
    if (!auth.permissions.includes(permission)) {
      await reply.code(403).send({ error: `Forbidden — missing permission: ${permission}` });
    }
  };
}
