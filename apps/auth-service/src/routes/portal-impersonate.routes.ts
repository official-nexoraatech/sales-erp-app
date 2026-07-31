import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { crmPortalAccounts, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS, NotFoundError } from '@erp/types';
import { signAccessToken } from '../jwt.js';
import { requirePermission } from '../middleware/authorize.js';
import { inetParam } from '../db-helpers.js';

const ImpersonatePortalBody = z.object({
  customerId: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

const IMPERSONATION_TOKEN_TTL_SECONDS = 3600; // 1 hour max, same cap as staff impersonation.

// Deliberately no companion /end route (unlike impersonate.routes.ts's /admin/impersonate/end):
// a CUSTOMER-role token — including this impersonation one — is rejected by every staff
// service's authenticate.ts (Finding 1), so it can never call back into any staff-authenticated
// route to "end" itself. The token is short-lived and simply expires; the staff member's own
// original session is kept client-side and resumes once they close the impersonation view.
export async function portalImpersonateRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  fastify.post('/admin/impersonate/portal-customer', {
    preHandler: [requirePermission(PERMISSIONS.IMPERSONATE_PORTAL_CUSTOMER)],
    handler: async (request, reply) => {
      const body = ImpersonatePortalBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const { userId: actorId, tenantId, roles } = request.auth;
      const { customerId, reason } = body.data;

      const [account] = await db
        .select()
        .from(crmPortalAccounts)
        .where(
          and(
            eq(crmPortalAccounts.customerId, customerId),
            eq(crmPortalAccounts.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!account) throw new NotFoundError('Customer portal account', customerId);

      const accessToken = await signAccessToken(
        {
          sub: String(account.id),
          tenantId,
          email: account.email,
          roles: ['CUSTOMER'],
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
        details: { surface: 'CUSTOMER_PORTAL', customerId, portalAccountId: account.id, reason },
      });

      return reply.code(200).send({ data: { accessToken } });
    },
  });
}
