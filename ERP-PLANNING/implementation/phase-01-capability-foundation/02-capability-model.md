# 02 — Capability Model

Supersedes the Module/Capability split in `multi-industry-platform/04-domain-model.md`/`05-module-capability-model.md` per `21-capability-resolution-architecture.md` §1 — one flat vocabulary, no two-tier hierarchy.

## 1. Canonical capability key

`SCREAMING_SNAKE_CASE`, singular domain noun phrase, no verb. Examples used in this phase: `HR_PAYROLL`, `POS`. Non-examples (rejected forms): `TRACK_PAYROLL` (verb), `hr-payroll` (wrong case), `PAYROLL_TRACKING` (verb-ish noun phrase — prefer the shorter domain noun).

## 2. Capability metadata shape

```ts
export interface CapabilityDefinition {
  key: string; // 'HR_PAYROLL'
  name: string; // 'HR Payroll' — human-readable, for future admin UI
  domain: string; // 'HR' — which bounded context conceptually owns this
  owningService: string; // 'hr-service' — where the enforcement/behavior actually lives
  flagKey: string; // 'hr.payroll.enabled' — the ONE existing feature_flags key this maps to
  requires: string[]; // [] — prerequisite capability keys (composition, see §4)
  status: 'GA' | 'BETA' | 'DEPRECATED';
  applicableBusinessTypes: string[]; // ['CLOTH_RETAIL', 'GROCERY'] — documentation only, NOT an enforcement input
  permissions: string[]; // ['HR_VIEW', 'PAYROLL_PROCESS', ...] — cross-reference into permissions.ts, not a new permission source
}
```

Every field here is either descriptive/documentation (`name`, `domain`, `applicableBusinessTypes`) or a pointer into an existing system (`flagKey` → `feature_flags`, `permissions` → `packages/shared-types/src/permissions.ts`). No field introduces new runtime state.

## 3. Capability ≠ Feature Flag — kept conceptually distinct even at 1:1 mapping (explicit requirement)

A **Feature Flag** is a raw boolean toggle in the `feature_flags` table — it has no inherent business meaning beyond its key string. A **Capability** is a named, registered, documented product concept that happens to be _backed by_ one feature flag today. The distinction matters because:

- A capability's `flagKey` could change (e.g. if a flag is renamed/consolidated) without the capability's `key` changing — callers of `requireCapability('HR_PAYROLL')` are insulated from that.
- A capability might later require **more than one** flag (`requires: [...]` composition, §4) — the registry is the layer that would absorb that complexity, not every call site.
- Not every feature flag is a capability. `integrations.whatsapp.enabled` or `finance.tds.enabled`-style flags that gate a small internal behavior, not a whole product surface a user would recognize as "a thing my plan does/doesn't include," should NOT be registered as capabilities unless there's a real reason to gate a route/nav item on them. The registry only contains flags that are also meaningful **authorization/navigation boundaries** — registering every flag as a capability would be exactly the "generalize prematurely" mistake the governing brief warns against.

**This phase's registry intentionally has 1:1 key↔flag mapping for both entries** (`HR_PAYROLL` → `hr.payroll.enabled`, `POS` → `pos.enabled`) — not because 1:1 is architecturally required, but because that's what's evidenced today. The `requires: string[]` field exists specifically so a future capability needing multiple flags doesn't require a breaking change to `CapabilityDefinition`'s shape.

## 4. Dependency (composition) semantics — DAG, not hierarchy

Per governing-prompt §9.4: capability dependencies form a **directed acyclic graph**, not a rigid two-level hierarchy. `CapabilityDefinition.requires: string[]` lists prerequisite capability _keys_. Resolution rule:

```
isCapabilityEnabled(tenantId, key):
  def = CAPABILITY_REGISTRY[key]
  if def.flagKey not enabled for tenantId → false
  for each dep in def.requires:
    if !isCapabilityEnabled(tenantId, dep) → false
  return true
```

- **Cycles**: not allowed. A registry-completeness check (unit test, `12-testing-strategy.md`) walks every `requires` edge at build/test time and fails if a cycle is detected — caught in CI, not at runtime, since the registry is static code, not dynamic data.
- **What happens when a dependency is disabled**: the dependent capability resolves `false` too (fails closed, transitively) — no special error distinguishing "your own flag is off" from "a prerequisite is off"; both produce the same `CAPABILITY_NOT_ENABLED` response (simpler contract, and a tenant admin fixing their config should look at prerequisites regardless of which layer failed).
- **No dependency exists between this phase's 2 registered capabilities** (`HR_PAYROLL`, `POS` are independent) — the DAG mechanism is built and unit-tested with a synthetic 2-node example (`A requires B`) rather than forcing an artificial real dependency between HR and POS, which don't actually depend on each other.

## 5. What this model explicitly does not introduce

- No DB table for the registry (`10-database-and-migrations.md`).
- No "Module" tier above Capability (superseded terminology, `21-capability-resolution-architecture.md` §1).
- No capability-to-industry hard binding — `applicableBusinessTypes` is documentation, never read by `requireCapability` (enforcement is purely flag-state-based, not business-type-based) — this keeps the enforcement mechanism fully decoupled from the (separately-tracked) Business Profile workstream, matching `00-roadmap-analysis.md`'s dependency correction.
