import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, assertTenantActive, type AuthPayload } from '@erp/sdk';

// A verified portal session — customerId is guaranteed present and numeric (checked below),
// unlike AuthPayload's own optional customerId field.
export interface PortalAuthPayload extends AuthPayload {
  customerId: number;
}

// Deliberately a SEPARATE request field from `request.auth` (used by `authenticate` for staff
// sessions) rather than a shared one — every existing staff route reads `request.auth` and
// assumes an employee's shape (permissions, branchIds that mean something); keeping the two
// fields apart means a staff route can never accidentally be satisfied by a portal session
// just because both preHandlers happened to populate the same property.
declare module 'fastify' {
  interface FastifyRequest {
    portalAuth: PortalAuthPayload;
  }
}

// CRM-ROADMAP Phase 3, Feature 2 (Self-Service Customer Portal): the customer-facing
// counterpart to `authenticate.ts`. Every /portal/* route uses this instead of `authenticate`
// — the reverse of Finding 1's fix (which rejects a CUSTOMER-role token from every *staff*
// route), this one rejects anything that ISN'T a valid CUSTOMER-role token with a customerId
// claim, so a staff JWT can't wander into a portal route either.
export async function requirePortalAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    await reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' },
    });
    return;
  }

  let auth: AuthPayload;
  try {
    auth = await verifyAccessToken(authHeader.slice(7));
  } catch {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    return;
  }

  if (!auth.roles.includes('CUSTOMER') || typeof auth.customerId !== 'number') {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'A portal session is required' } });
    return;
  }

  await assertTenantActive(auth.tenantId, []);

  request.portalAuth = { ...auth, customerId: auth.customerId };
}
