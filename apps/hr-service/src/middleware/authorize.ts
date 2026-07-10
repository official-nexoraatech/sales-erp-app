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
      await reply.code(403).send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${permission}` } });
    }
  };
}
