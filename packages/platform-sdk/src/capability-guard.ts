import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import type Redis from 'ioredis';
import { CAPABILITY_REGISTRY } from '@erp/types';
import { erpCapabilityCheckDeniedTotal } from '@erp/logger';
import { PlatformFeatureFlags } from './feature-flags.js';
import { TenantScopedDatabase } from './database.js';
import { TenantScopedCache } from './cache.js';

// Mirrors requirePermission()'s exact shape (direct reply.code().send(), never throws) —
// see ERP-PLANNING/implementation/phase-01-capability-foundation/05-platform-sdk.md.
export function requireCapability(
  capabilityKey: string,
  db: ErpDatabase,
  redis: Redis
): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const auth = (request as FastifyRequest & { auth?: { tenantId: number } }).auth;
    if (!auth) {
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
      return;
    }

    // Three distinct resolution outcomes (Decision 5) — "capability disabled" (resolved
    // cleanly to false) and "capability resolution failure" (the resolution call itself
    // couldn't complete) are different operational states and must be distinguishable, even
    // though both deny the request (fail-closed governs the access decision, not the status
    // code — see 04-capability-resolution.md §5).
    let enabled: boolean;
    try {
      enabled = await isCapabilityEnabled(capabilityKey, auth.tenantId, db, redis);
    } catch (err) {
      // Resolution itself failed (DB/Redis/infra/config) — state is UNKNOWN, not "no". Must
      // never be reported as CAPABILITY_NOT_ENABLED, which would misrepresent an
      // infrastructure outage as a deliberate plan restriction.
      request.log.error(
        { err, tenantId: auth.tenantId, capabilityKey },
        'Capability resolution failed — denying (fail-closed), reporting as unavailable, not disabled'
      );
      erpCapabilityCheckDeniedTotal.inc({
        capability_key: capabilityKey,
        outcome: 'resolution_error',
      });
      await reply.code(503).send({
        error: {
          code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
          message: 'Unable to determine capability state. Please retry.',
          details: { capabilityKey },
        },
      });
      return;
    }

    if (!enabled) {
      // Resolution succeeded and definitively determined the capability is off.
      request.log.warn({ tenantId: auth.tenantId, capabilityKey }, 'Capability check denied');
      erpCapabilityCheckDeniedTotal.inc({ capability_key: capabilityKey, outcome: 'disabled' });
      await reply.code(403).send({
        error: {
          code: 'CAPABILITY_NOT_ENABLED',
          message: `This tenant's plan does not include ${capabilityKey}.`,
          details: { capabilityKey },
        },
      });
    }
  };
}

// Exported separately so background/non-route callers (e.g. computing enabledCapabilities
// for GET /users/me) can reuse the same resolution logic without going through a Fastify
// preHandler.
export async function isCapabilityEnabled(
  capabilityKey: string,
  tenantId: number,
  db: ErpDatabase,
  redis: Redis
): Promise<boolean> {
  const def = CAPABILITY_REGISTRY[capabilityKey];
  if (!def) return false; // fail-closed on unknown/unregistered key

  const tsDb = new TenantScopedDatabase(tenantId, db);
  const tsCache = new TenantScopedCache(redis, tenantId);
  const flags = new PlatformFeatureFlags(tsDb, tsCache, tenantId);

  if (!(await flags.isEnabled(def.flagKey))) return false;
  for (const dep of def.requires) {
    if (!(await isCapabilityEnabled(dep, tenantId, db, redis))) return false;
  }
  return true;
}
