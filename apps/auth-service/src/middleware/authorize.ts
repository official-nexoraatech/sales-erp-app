import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import type { Permission } from '@erp/types';

// Higher-order hook factory: requirePermission('INVOICE_CREATE')
export function requirePermission(permission: Permission): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    if (!auth) {
      await reply.code(401).send({ error: 'Unauthenticated' });
      return;
    }
    if (!auth.permissions.includes(permission)) {
      await reply.code(403).send({ error: `Forbidden — missing permission: ${permission}` });
      return;
    }
  };
}

// Grants access if the caller holds ANY of the listed permissions. Used where a route
// currently gates on one constant (e.g. VIEW_AUDIT_LOG) but a role was granted a
// near-duplicate-named one instead (e.g. AUDIT_LOG_VIEW) — checking both keeps every role's
// current access working while fixing the mismatch, instead of silently replacing the check
// and risking revoking access from a role that only has the other name.
export function requireAnyPermission(permissions: Permission[]): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { permissions: string[] } }).auth;
    if (!auth) {
      await reply.code(401).send({ error: 'Unauthenticated' });
      return;
    }
    if (!permissions.some((p) => auth.permissions.includes(p))) {
      await reply
        .code(403)
        .send({ error: `Forbidden — missing permission: one of ${permissions.join(', ')}` });
      return;
    }
  };
}
