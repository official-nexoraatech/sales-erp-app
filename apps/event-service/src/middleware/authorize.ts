import type { FastifyRequest, FastifyReply } from 'fastify';

export function requirePermission(permission: string) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.auth?.permissions.includes(permission)) {
      await reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: `Missing permission: ${permission}` },
      });
    }
  };
}
