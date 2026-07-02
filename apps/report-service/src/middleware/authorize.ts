import { FastifyRequest, FastifyReply, RouteHandlerMethod } from 'fastify';

export function requirePermission(permission: string): RouteHandlerMethod {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = request.auth;
    if (!auth) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }
    if (!auth.permissions.includes(permission)) {
      return reply.code(403).send({
        error: { code: 'FORBIDDEN', message: `Forbidden — missing permission: ${permission}` },
      });
    }
  };
}
