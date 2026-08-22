# 05 — `requireCapability()` in platform-sdk

## 1. Location

**NEW FILE** — `packages/platform-sdk/src/capability-guard.ts`, alongside the existing `feature-flags.ts`/`auth.ts` in the same package. Exported from `packages/platform-sdk/src/index.ts` (existing barrel file — add one export line, `05-platform-sdk.md` §5 / `17-file-level-change-plan.md`).

## 2. Signature and implementation

Mirrors `requirePermission`'s exact shape (`01-current-code-evidence.md` §1) — direct reply, no thrown error class, same tuple-composability:

```ts
// packages/platform-sdk/src/capability-guard.ts — NEW FILE
import type { FastifyRequest, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import type Redis from 'ioredis';
import { CAPABILITY_REGISTRY } from '@erp/types';
import { PlatformFeatureFlags } from './feature-flags.js';
import { TenantScopedDatabase } from './database.js';
import { TenantScopedCache } from './cache.js'; // CONFIRMED 2026-08-18: packages/platform-sdk/src/cache.ts,
// class TenantScopedCache, constructor(redis: Redis, tenantId: number) — already exported from
// this package's index.ts at line 12. No escape-hatch methods found on this class (unlike
// TenantScopedDatabase's .raw/.execute, see 01-current-code-evidence.md addendum) — every
// method routes through its internal scopeKey() prefixing, confirmed safe for this use.

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

    // Decision 5 (2026-08-18, corrects the earlier Decision 4 write-up): "capability disabled"
    // and "capability state could not be determined" are different operational states and must
    // be distinguishable, even though both deny the request (fail-closed governs the access
    // decision, not the status code — see 04-capability-resolution.md §5).
    let enabled: boolean;
    try {
      enabled = await isCapabilityEnabled(capabilityKey, auth.tenantId, db, redis);
    } catch (err) {
      // Resolution itself failed (DB/Redis/infra/config) — state is UNKNOWN, not "no". Must
      // never be reported as CAPABILITY_NOT_ENABLED, which would misrepresent an infrastructure
      // outage as a deliberate plan restriction.
      request.log.error(
        { err, tenantId: auth.tenantId, capabilityKey },
        'Capability resolution failed — denying (fail-closed), reporting as unavailable, not disabled'
      );
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

// Exported separately so background/non-route callers (05-platform-sdk.md §4) can reuse the
// same resolution logic without going through a Fastify preHandler.
export async function isCapabilityEnabled(
  capabilityKey: string,
  tenantId: number,
  db: ErpDatabase,
  redis: Redis
): Promise<boolean> {
  const def = CAPABILITY_REGISTRY[capabilityKey];
  if (!def) return false; // fail-closed on unknown key, see 04-capability-resolution.md §5

  const tsDb = new TenantScopedDatabase(tenantId, db);
  const tsCache = new TenantScopedCache(redis, tenantId);
  const flags = new PlatformFeatureFlags(tsDb, tsCache, tenantId);

  if (!(await flags.isEnabled(def.flagKey))) return false;
  for (const dep of def.requires) {
    if (!(await isCapabilityEnabled(dep, tenantId, db, redis))) return false;
  }
  return true;
}
```

**Two distinct log lines AND two distinct response codes, not one of either** (refines `14-observability-and-audit.md` §1, corrected for Decision 5): an `error`-level line when resolution itself _fails_ (the `catch` block above — an operational signal, "the capability system is unhealthy," producing `503 CAPABILITY_RESOLUTION_UNAVAILABLE`), separate from a `warn`-level line on an ordinary, successfully-resolved denial (flag cleanly resolves `false`, producing `403 CAPABILITY_NOT_ENABLED`). Unlike the earlier (superseded) design, these no longer collapse into the same response to the caller — the distinction is both for operators (via log level/metrics) and for the caller (via status code), since a 503 legitimately invites a client retry in a way a 403 should not.

**Note on `TenantScopedCache`**: referenced by name from `01-current-code-evidence.md` §4's real usage (`apps/auth-service/src/routes/feature-flags.routes.ts:73`) but its exact module path within `packages/platform-sdk/src` was not independently re-confirmed in this pass — the implementing session must verify the exact import path before writing this file (do not guess; grep `class TenantScopedCache` in `packages/platform-sdk/src`).

## 3. Error type and HTTP status

Direct `reply.send()`, not a thrown `ERPError`/`BusinessError` — see `01-current-code-evidence.md` §2 for why this matters (staying consistent with `requirePermission`'s actual pattern, not the `BusinessError`/422 pattern used elsewhere). Full contract in `11-api-contracts.md`.

## 4. Logging

A single structured log line on denial only (not on success — matches the zero-logging-on-success precedent of `requirePermission`, avoids log volume blowup), via `@erp/logger`'s existing `createLogger` pattern already used throughout the codebase (e.g. `BillingService.ts`'s `logger.info(...)` calls). No audit_log/security_audit_log write — matches `requirePermission`'s confirmed precedent of not auditing permission denials (`01-current-code-evidence.md` §1's finding). Full detail in `14-observability-and-audit.md`.

## 5. Audit behavior

None beyond the structured log above — explicitly matching existing precedent, not a gap this phase introduces (`requirePermission` itself doesn't audit denials either, confirmed by evidence).

## 6. Tenant context requirements

Requires `request.auth.tenantId` to exist — i.e., `requireCapability` must always run **after** `authenticate` in the preHandler chain, exactly like `requirePermission`. If `authenticate` hasn't run (misconfigured route), `request.auth` is `undefined` and this guard correctly replies `401` rather than crashing (mirrors `requirePermission`'s own `unauthenticated` branch).

## 7. Interaction with `requirePermission` — composed, not merged

Two independent, ordered preHandlers, never merged into one function:

```ts
{
  preHandler: [
    authenticate,
    requireCapability('HR_PAYROLL', db, redis),
    requirePermission(PERMISSIONS.PAYROLL_PROCESS),
  ];
}
```

Capability check first (cheaper conceptually — "is this even part of your plan" before "do you personally have access"), matching `21-capability-resolution-architecture.md` §3's decided ordering. Each guard is independently testable and independently revertible (removing the capability check from a route doesn't touch the permission check's behavior at all).

## 8. Direct-service-access safety

This is the core security property this phase must get right. Because `requireCapability` is invoked as a normal preHandler inside each service's own route registration — not at the gateway — a request that reaches `sales-service` (or any service) directly, bypassing `api-gateway` entirely, still passes through `authenticate` → `requireCapability` → `requirePermission` exactly as if it arrived via the gateway. Verified this session that this protection is **not redundant**: `infrastructure/k8s/network-policy.yaml`/`infrastructure/istio/authorization-policy.yaml` do **not** block direct pod-to-pod calls to any backend service except `auth-service` (and even that rule is incomplete per its own TODO comment) — meaning code-level, per-service enforcement is the _only_ thing preventing a direct-to-service call from bypassing capability checks today. This is why `21-capability-resolution-architecture.md` §3's "gateway must not be the sole enforcement point" decision is a hard security requirement, not a style preference, and why this plan never proposes adding capability logic to `api-gateway`.

## 9. This phase does NOT wire `requireCapability` onto any real route

Per `00-overview.md`'s scope — this file's function is built, unit- and integration-tested against a throwaway test route (`06-service-enforcement.md`), but no production route in `hr-service`, `sales-service`, or any other service is modified in this phase.
