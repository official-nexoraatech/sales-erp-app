import type { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';

export function requirePermission(permission: string): RouteHandlerMethod {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    if (!auth) {
      await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } });
      return;
    }
    if (!auth.permissions.includes(permission)) {
      await reply
        .code(403)
        .send({ error: { code: 'PERMISSION_DENIED', message: `Forbidden — missing permission: ${permission}` } });
    }
  };
}
