import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { crmLeads, crmOpportunities, crmAccounts, crmAccountContacts } from '@erp/db';
import { ApiKeyService, type PublicApiScope } from '../domain/ApiKeyService.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyAuth?: { tenantId: number; apiKeyId: number; scopes: string[] };
  }
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePagination(query: unknown): { limit: number; offset: number } {
  const q = query as { limit?: string; offset?: string };
  const limit = Math.min(
    Math.max(parseInt(q.limit ?? '', 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const offset = Math.max(parseInt(q.offset ?? '', 10) || 0, 0);
  return { limit, offset };
}

/**
 * CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
 *
 * A read-only external API surface, authenticated by a per-tenant API key (see
 * ApiKeyService.ts), never a staff JWT — this is why these routes carry their own
 * `requirePublicApiScope` preHandler rather than the shared `authenticate` hook, the same
 * separate-auth-mechanism precedent as `requirePortalAuth` (Phase 3, Feature 2). The key is
 * presented via `x-api-key`, deliberately not `Authorization: Bearer`, so it can never be
 * confused with (or accidentally forwarded as) a staff/portal JWT bearer token.
 *
 * Uses the raw `ErpDatabase` handle directly, not `ctxFactory`/`PlatformContext` — same
 * reasoning as portalRoutes: there is no employee/customer "actor" here to attribute an
 * audit-log entry or event to, only a named API key.
 */
function requirePublicApiScope(scope: PublicApiScope, db: ErpDatabase) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<undefined> => {
    const rawKey = request.headers['x-api-key'];
    if (typeof rawKey !== 'string' || !rawKey) {
      await reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Missing x-api-key header' } });
      return;
    }
    const auth = await ApiKeyService.authenticate(db, rawKey);
    if (!auth) {
      await reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked API key' } });
      return;
    }
    if (!auth.scopes.includes(scope)) {
      await reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: `API key lacks required scope: ${scope}` } });
      return;
    }
    request.apiKeyAuth = auth;
    return;
  };
}

export async function publicApiRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.get(
    '/public/v1/leads',
    { preHandler: requirePublicApiScope('leads:read', db) },
    async (request, reply) => {
      const { tenantId } = request.apiKeyAuth!;
      const { limit, offset } = parsePagination(request.query);
      const rows = await db
        .select({
          id: crmLeads.id,
          displayName: crmLeads.displayName,
          companyName: crmLeads.companyName,
          phone: crmLeads.phone,
          email: crmLeads.email,
          source: crmLeads.source,
          stage: crmLeads.stage,
          assignedTo: crmLeads.assignedTo,
          isB2b: crmLeads.isB2b,
          createdAt: crmLeads.createdAt,
          updatedAt: crmLeads.updatedAt,
        })
        .from(crmLeads)
        .where(eq(crmLeads.tenantId, tenantId))
        .orderBy(desc(crmLeads.createdAt))
        .limit(limit)
        .offset(offset);
      return reply.code(200).send({ data: { content: rows, limit, offset } });
    }
  );

  fastify.get(
    '/public/v1/opportunities',
    { preHandler: requirePublicApiScope('opportunities:read', db) },
    async (request, reply) => {
      const { tenantId } = request.apiKeyAuth!;
      const { limit, offset } = parsePagination(request.query);
      const rows = await db
        .select({
          id: crmOpportunities.id,
          name: crmOpportunities.name,
          dealType: crmOpportunities.dealType,
          stage: crmOpportunities.stage,
          probability: crmOpportunities.probability,
          value: crmOpportunities.value,
          expectedCloseDate: crmOpportunities.expectedCloseDate,
          customerId: crmOpportunities.customerId,
          accountId: crmOpportunities.accountId,
          assignedTo: crmOpportunities.assignedTo,
          wonAt: crmOpportunities.wonAt,
          lostAt: crmOpportunities.lostAt,
          createdAt: crmOpportunities.createdAt,
          updatedAt: crmOpportunities.updatedAt,
        })
        .from(crmOpportunities)
        .where(eq(crmOpportunities.tenantId, tenantId))
        .orderBy(desc(crmOpportunities.createdAt))
        .limit(limit)
        .offset(offset);
      return reply.code(200).send({ data: { content: rows, limit, offset } });
    }
  );

  fastify.get(
    '/public/v1/accounts',
    { preHandler: requirePublicApiScope('accounts:read', db) },
    async (request, reply) => {
      const { tenantId } = request.apiKeyAuth!;
      const { limit, offset } = parsePagination(request.query);
      const rows = await db
        .select({
          id: crmAccounts.id,
          name: crmAccounts.name,
          accountType: crmAccounts.accountType,
          primaryPhone: crmAccounts.primaryPhone,
          primaryEmail: crmAccounts.primaryEmail,
          createdAt: crmAccounts.createdAt,
          updatedAt: crmAccounts.updatedAt,
        })
        .from(crmAccounts)
        .where(and(eq(crmAccounts.tenantId, tenantId)))
        .orderBy(desc(crmAccounts.createdAt))
        .limit(limit)
        .offset(offset);
      return reply.code(200).send({ data: { content: rows, limit, offset } });
    }
  );

  fastify.get(
    '/public/v1/contacts',
    { preHandler: requirePublicApiScope('contacts:read', db) },
    async (request, reply) => {
      const { tenantId } = request.apiKeyAuth!;
      const { limit, offset } = parsePagination(request.query);
      const rows = await db
        .select({
          id: crmAccountContacts.id,
          accountId: crmAccountContacts.accountId,
          name: crmAccountContacts.name,
          role: crmAccountContacts.role,
          email: crmAccountContacts.email,
          phone: crmAccountContacts.phone,
          isPrimary: crmAccountContacts.isPrimary,
          createdAt: crmAccountContacts.createdAt,
        })
        .from(crmAccountContacts)
        .where(eq(crmAccountContacts.tenantId, tenantId))
        .orderBy(desc(crmAccountContacts.createdAt))
        .limit(limit)
        .offset(offset);
      return reply.code(200).send({ data: { content: rows, limit, offset } });
    }
  );
}
