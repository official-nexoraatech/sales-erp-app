import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, assertTenantActive, type AuthPayload } from '@erp/sdk';

// A verified partner session — customerId is guaranteed present and numeric (checked below),
// unlike AuthPayload's own optional customerId field.
export interface PartnerAuthPayload extends AuthPayload {
  customerId: number;
}

// Deliberately a field SEPARATE from both `request.auth` (staff) and `request.portalAuth`
// (customer) — a staff or customer route can never accidentally be satisfied by a partner
// session just because their preHandlers happened to populate the same property.
declare module 'fastify' {
  interface FastifyRequest {
    partnerAuth: PartnerAuthPayload;
  }
}

// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal): mirrors portal-auth.ts's
// requirePortalAuth exactly for the PARTNER auth scope. Every /partner/* route uses this
// instead of `authenticate` — rejects anything that isn't a valid PARTNER-role token with a
// customerId claim, so a staff or customer JWT can't wander into a partner route either.
export async function requirePartnerAuth(
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

  if (!auth.roles.includes('PARTNER') || typeof auth.customerId !== 'number') {
    await reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: 'A partner session is required' } });
    return;
  }

  await assertTenantActive(auth.tenantId, []);

  request.partnerAuth = { ...auth, customerId: auth.customerId };
}
