# 10 — Scalability & Operability Audit

Evaluates architectural scalability (O(N tenant)/O(N capability)/O(N permission) request-path patterns), not CPU/database tuning.

## 6a. Capability resolution — sound design, one real inefficiency in the hot path

The two-tier cache design is genuinely sound: `packages/platform-sdk/src/feature-flags.ts` has L1 in-memory (30s TTL) plus L2 Redis (300s TTL) with pub/sub invalidation, so a flag change propagates to every process's L1 without waiting out the TTL — when wired correctly, capability resolution is O(1) in-memory for repeat checks.

**But `requireCapability()` — the actual route-preHandler entry point used by every production route that gates by capability — never passes the shared L1 cache.** `capability-guard.ts:78-80` constructs `new PlatformFeatureFlags(tsDb, tsCache, tenantId)` with the 4th constructor argument (`sharedL1Cache`) omitted, so `feature-flags.ts:39` falls back to a **brand-new, empty Map on every single call**, discarded the instant the function returns. The L1 tier is therefore structurally dead code on this path — every capability check, including recursive `requires`-dependency checks, hits Redis at minimum, every single time, for every request. `MRP requires [BOM, PRODUCTION_ORDER]` means one `requireCapability('MRP', ...)` call does up to 3 sequential Redis round-trips, none benefiting from any prior check in the same request or across requests via L1. Rated **MEDIUM** — not O(N) DB load (Redis absorbs it, ~1ms per round-trip), but the two-tier design's entire purpose (near-zero-latency, zero-Redis-load repeat checks) is unrealized on every guarded route today, and this gets worse, not better, as request volume grows.

## 6b/6c. Navigation and RBAC — no gap found

Navigation filtering is a plain client-side recursive tree filter over already-loaded data (JWT-derived permissions + capability list) — O(N nav items), no network calls inside the filter, no scalability concern. RBAC permission evaluation is `auth.permissions.includes(permission)` — a synchronous check against a JWT-embedded array, independent of tenant count or role→permission-map size. Best-case architecture; no gap.

## 6d. Scheduler-service startup — CONFIRMED real O(N tenants × M jobs) sequential loop

This is the one concrete "unbounded per-tenant loop" this audit specifically hunted for, and it is real. `apps/scheduler-service/src/main.ts:107-131`:

```
const activeTenantIds = (await db.select(...).from(tenants).where(eq(tenants.status,'ACTIVE'))).map(...)
for (const { name, config } of registry.listAll()) {
  if (config.manualOnly) continue;
  if (config.tenantScoped) {
    for (const tenantId of activeTenantIds) {
      await registry.schedule(name, tenantId).catch(...)   // sequential await, not Promise.all
    }
  } else { await registry.schedule(name).catch(...) }
}
```

`registry.schedule()` performs a real, awaited BullMQ/Redis round-trip per call. **~30 distinct `tenantScoped: true` job configs** were confirmed via grep, out of ~44 registered jobs total. With N active tenants, this loop performs roughly **30×N sequential awaited Redis calls** before `fastify.listen()` is reached. At dozens of tenants this is seconds; at the "hundreds/thousands of tenants" scale the platform is nominally being built for, this is plausibly minutes of blocking startup work.

**Compounding**: the health route is registered _after_ this loop completes (`registerHealthRoute` call is later in `main.ts` than the loop, `fastify.listen` later still) — meaning `/health` and the whole HTTP server are **unreachable until the entire per-tenant scheduling pass finishes**. In a container-orchestrated rolling deploy, this directly risks failed readiness/liveness probes and deploy timeouts as tenant count scales, which is the exact failure mode this audit was asked to look for. No batching (`Promise.all` with a concurrency limit) or lazy/background scheduling was found. Rated **HIGH** — not a blocker at today's presumed dev-stage tenant count, but a genuine, unmitigated architectural pattern that will degrade service startup time and deploy reliability as tenant count grows.

Note: once scheduled, individual job **execution** is well-isolated per tenant (§7 below) — the risk is specifically in the bootstrap/scheduling phase, not steady-state running.

## 7. Background job / scheduler resilience — VERIFIED GOOD

Every registered job gets its own BullMQ `Queue` with `attempts: 3`, exponential backoff. Tenant-scoped jobs get **one BullMQ job per tenant** (`jobId = "${name}:${tenantId}"`), so one tenant's job failure is an independent BullMQ retry-cycle from another tenant's — a single failing tenant's job does **not** silently break the whole batch run, by construction. Per-run distributed locking (Redis `SET NX EX`) prevents duplicate concurrent runs; lock-contention skips are recorded, not silently dropped. Full lifecycle observability exists via a `job_history` table plus Prometheus metrics (`erp_job_execution_total`, `erp_job_duration_seconds`, `erp_job_last_success_timestamp`), all best-effort/non-fatal on their own failure. Worker concurrency is capped at 2 per job type — plausible secondary bottleneck once the §6d startup issue is fixed (30 jobs × N tenants onto queues each processed at concurrency 2 could create a growing backlog if job duration × tenant count exceeds the cron interval), but this was **not independently measured** — flagged as a follow-up question, not a confirmed finding.

## Observability & auditability — see also `09-ai-copilot-readiness.md`

**Health-check coverage: 18/18 backend services, complete.** All confirmed via `registerHealthRoute()` (17 via `main.ts` grep, `api-gateway` verified directly — it additionally probes every configured upstream over HTTP). No service found without health-check coverage.

**Metrics inventory** (`packages/logger/src/erp-metrics.ts`): invoice, saga, outbox/DLQ, inventory, auth, tenant-lifecycle, generic HTTP, scheduled-job, search, and capability-denial metrics all exist, all tenant-labeled except scheduled-job metrics (deliberately, to avoid a documented cardinality blowup — `job_name × status` is already ~130+ series across 44 jobs) and saga/outbox metrics (labeled by type/topic, not tenant — plausible for platform-level operational signals, not independently assessed as a gap). The capability-denial metric is denial-only — there is no "capability check succeeded" counter, so a usage rate cannot be computed, only a denial rate.

**The two audit example questions**, restated from `09-ai-copilot-readiness.md` since they're general observability findings, not copilot-specific:

- "Why does Tenant X have Capability Y?" — **not answerable**: entitlement/capability grant mutations are never audit-logged (`04-multitenancy-security.md`, `05-capability-entitlement-rbac.md`, `09-ai-copilot-readiness.md` all independently confirm this from different entry points). Rated **HIGH**.
- "Why did User Z get denied?" — **capability denials: yes. Plain RBAC denials: no**, identically across all 15 services. Rated **HIGH**.

## Ranked findings

| #   | Finding                                                                                                                                    | Severity     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | scheduler-service startup: sequential O(N tenants × ~30 jobs) loop before health route is reachable — deploy/readiness-probe risk at scale | **HIGH**     |
| 2   | Entitlement/capability grant changes never audit-logged (cross-referenced from `05`, `09`)                                                 | **HIGH**     |
| 3   | RBAC permission denials never logged/metered, identical gap across all 15 services (cross-referenced from `09`)                            | **HIGH**     |
| 4   | `requireCapability()`'s hot path never uses the shared L1 cache — every check hits Redis minimum                                           | MEDIUM       |
| 5   | Worker concurrency (2 per job type) not verified sufficient at scale — flagged, not measured                                               | NOT VERIFIED |

## Confirmed correct, no gap

Per-tenant BullMQ job isolation and retry/backoff · distributed locking · job-history + Prometheus observability for scheduled jobs · 18/18 service health-check coverage · navigation/RBAC evaluation cost (both O(1)/cheap, no scalability concern).
