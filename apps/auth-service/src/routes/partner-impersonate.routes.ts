import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { crmPartnerAccounts, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, NotFoundError } from '@erp/types';
import { signAccessToken } from '../jwt.js';
import { requirePermission } from '../middleware/authorize.js';
import { inetParam } from '../db-helpers.js';

const ImpersonatePartnerBody = z.object({
  customerId: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

const IMPERSONATION_TOKEN_TTL_SECONDS = 3600; // 1 hour max, same cap as portal-impersonate.routes.ts.

// Mirrors portal-impersonate.routes.ts exactly for the PARTNER auth scope. Deliberately no
// companion /end route — a PARTNER-role token is rejected by every staff service's
// authenticate.ts (same hardening as CUSTOMER), so it can never call back into any staff route
// to "end" itself; it simply expires.
export async function partnerImpersonateRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  fastify.post('/admin/impersonate/partner', {
    preHandler: [requirePermission(PERMISSIONS.IMPERSONATE_PARTNER)],
    handler: async (request, reply) => {
      const body = ImpersonatePartnerBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const { userId: actorId, tenantId, roles } = request.auth;
      const { customerId, reason } = body.data;

      const [account] = await db
        .select()
        .from(crmPartnerAccounts)
        .where(
          and(
            eq(crmPartnerAccounts.customerId, customerId),
            eq(crmPartnerAccounts.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!account) throw new NotFoundError('Partner account', customerId);

      const accessToken = await signAccessToken(
        {
          sub: String(account.id),
          tenantId,
          email: account.email,
          roles: ['PARTNER'],
          permissions: [],
          branchIds: [],
          customerId: account.customerId,
          impersonatedBy: actorId,
          isImpersonation: true,
        },
        IMPERSONATION_TOKEN_TTL_SECONDS
      );

      await db.insert(securityAuditLog).values({
        tenantId,
        actorId,
        actorRole: roles[0] ?? null,
        action: 'IMPERSONATION_START',
        ipAddress: inetParam(request.ip),
        details: { surface: 'PARTNER_PORTAL', customerId, partnerAccountId: account.id, reason },
      });

      return reply.code(200).send({ data: { accessToken } });
    },
  });
}
