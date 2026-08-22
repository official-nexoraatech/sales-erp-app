import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformContext, PlatformContextFactory } from './context.js';
import { withTenantConnection } from './tenantConnection.js';

// Each service declares its own, fuller `request.auth: AuthPayload` augmentation (see e.g.
// apps/*/src/middleware/authenticate.ts) — platform-sdk doesn't own that declaration, so this
// narrows to just the two fields this file needs, matching authorize.ts's own cast pattern.
interface RequestWithAuth {
  auth?: { tenantId: number; userId: number };
}

// Multi-industry platform, Phase 9 — pilot rollout of the GUC-per-request fix (see
// tenantConnection.ts for the why/how, including the dead-end reserve()-based attempt).
//
// Wraps a route handler so its entire body runs inside one real transaction with
// app.current_tenant_id correctly set — required because postgres-js's `.begin()` only stays
// open for the callback's lifetime, so there is no way to "prepare in a preHandler, release in
// onResponse" the way a reserved connection would have allowed. Register AFTER the route tree's
// `authenticate` preHandler has already run (request.auth must be populated).
//
// Deliberately NOT wired into every route in every service yet: this is a foundational,
// hard-to-reverse change to the request lifecycle, and 13-security-architecture.md's own
// recommendation is a table-by-table, monitored rollout (same caution it prescribes for RLS
// itself). See ERP-PLANNING/multi-industry-platform/23-guc-per-request-rollout-checklist.md for
// the remaining services/routes, how to migrate each one, and the one real behavior change this
// introduces (a handler's entire body now commits/rolls back as one unit).
export function tenantScopedHandler(
  ctxFactory: PlatformContextFactory,
  handler: (req: FastifyRequest, reply: FastifyReply, ctx: PlatformContext) => Promise<unknown>
): (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const auth = (req as unknown as RequestWithAuth).auth;
    if (!auth) {
      throw new Error(
        'tenantScopedHandler requires the authenticate preHandler to run first (request.auth is unset)'
      );
    }

    return withTenantConnection(ctxFactory.rawDb, auth.tenantId, async (scopedDb) => {
      const ctx = ctxFactory.create(
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? req.id,
        },
        scopedDb
      );
      return handler(req, reply, ctx);
    });
  };
}
