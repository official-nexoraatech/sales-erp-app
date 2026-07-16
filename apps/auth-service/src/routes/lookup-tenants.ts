import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { users, tenants } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import type { AuthConfig } from '../config.js';

const LookupTenantsBody = z.object({
  email: z.string().email(),
});

// Pre-login step for the org switcher: given an email, return the ACTIVE workspaces it
// has an ACTIVE account in, so the login form can skip asking the user to already know
// their numeric tenantId. Same "no tenantId yet" auth-less shape as /auth/login, so it
// needs its own IP-keyed rate limit (see LOOKUP_TENANTS_RATE_LIMIT_* in config.ts) —
// unlike /auth/login this endpoint's response shape itself reveals whether an email has
// an account (an empty vs non-empty list), which /auth/login deliberately avoids via its
// constant-time dummy-hash path. That's an accepted, well-precedented trade-off for this
// kind of org-picker UX (Slack/Notion/Asana all do the same) — rate limiting is the
// mitigation, not response-shape secrecy.
export async function lookupTenantsRoute(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig
): Promise<void> {
  fastify.post('/auth/lookup-tenants', {
    config: {
      rateLimit: {
        max: config.lookupTenantsRateLimitMax,
        timeWindow: config.lookupTenantsRateLimitWindowMs,
      },
    },
    handler: async (request, reply) => {
      const body = LookupTenantsBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const rows = await db
        .select({ tenantId: tenants.id, name: tenants.name, slug: tenants.slug })
        .from(users)
        .innerJoin(tenants, eq(users.tenantId, tenants.id))
        .where(
          and(
            eq(users.email, body.data.email),
            eq(users.isActive, true),
            eq(tenants.status, 'ACTIVE')
          )
        );

      return reply.code(200).send({ data: { tenants: rows } });
    },
  });
}
