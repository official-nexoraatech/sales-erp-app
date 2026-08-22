# 03 — Capability Registry

## 1. Location

**NEW FILE** — `packages/shared-types/src/capability-registry.ts`. Placed in `shared-types` (not `platform-sdk`) because `permissions.ts` — the file whose `permissions: string[]` field entries this registry cross-references — already lives there, and both are pure data/type definitions with no runtime dependencies, consistent with `shared-types`'s existing role in the monorepo (it has zero imports from `platform-sdk`, avoiding a circular dependency: `platform-sdk` will import `shared-types` for `CAPABILITY_REGISTRY`, not the reverse).

## 2. Full proposed content

```ts
// packages/shared-types/src/capability-registry.ts
// NEW FILE. See ERP-PLANNING/multi-industry-platform/21-capability-resolution-architecture.md
// and ERP-PLANNING/implementation/phase-01-capability-foundation/02-capability-model.md.
//
// One registry entry, one PR — never registered speculatively ahead of the code/flag it
// describes. Only 2 entries exist in this phase, deliberately (see 03-capability-registry.md §4).

export interface CapabilityDefinition {
  key: string;
  name: string;
  domain: string;
  owningService: string;
  flagKey: string;
  requires: string[];
  status: 'GA' | 'BETA' | 'DEPRECATED';
  applicableBusinessTypes: string[];
  permissions: string[];
}

export const CAPABILITY_REGISTRY: Record<string, CapabilityDefinition> = {
  HR_PAYROLL: {
    key: 'HR_PAYROLL',
    name: 'HR Payroll',
    domain: 'HR',
    owningService: 'hr-service',
    flagKey: 'hr.payroll.enabled',
    requires: [],
    status: 'GA',
    applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'],
    permissions: ['PAYROLL_PROCESS', 'PAYROLL_VIEW'],
  },
  POS: {
    key: 'POS',
    name: 'Point of Sale',
    domain: 'Sales',
    owningService: 'sales-service',
    flagKey: 'pos.enabled',
    requires: [],
    status: 'GA',
    applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'],
    permissions: ['POS_SALE_CREATE', 'POS_MANAGE'],
  },
};

export function getCapabilityDefinition(key: string): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY[key];
}
```

**Note on `permissions` field values above**: `PAYROLL_PROCESS`/`PAYROLL_VIEW` and `POS_SALE_CREATE`/`POS_MANAGE` are illustrative — the implementing coding session must grep `packages/shared-types/src/permissions.ts` for the exact real constant names before finalizing this file (this plan does not re-paste all ~330 permission constants; verify these specific ones exist verbatim before committing, per the "do not invent" discipline).

## 3. Registry-completeness invariant (enforced by a unit test, not runtime code)

Every `CAPABILITY_REGISTRY` entry's `flagKey` must correspond to a flag key that's real (i.e., appears in `TenantProvisioner.ts`'s seed list or a migration's seed data) — checked by a test that imports both the registry and a hardcoded list of known-real flag keys (see `12-testing-strategy.md` §1). This is a documentation-consistency check, not a runtime guard (runtime doesn't need to validate — `PlatformFeatureFlags.isEnabled` on an unrecognized key already safely returns `false` per its existing "missing flag defaults to disabled" behavior, `01-current-code-evidence.md` §3).

## 4. Why only 2 entries in this phase (explicit answer to "why not register everything now")

Per governing-prompt §25.12 ("every new abstraction must have evidence from at least two real consumers when practical") and §25.8 ("do not generalize prematurely") — registering all ~20 existing flags as capabilities in one pass, before any route actually consumes the registry, would be exactly the speculative-abstraction anti-pattern the source architecture repeatedly warns against. `HR_PAYROLL` and `POS` are chosen because: (a) both flags are confirmed real and currently seeded for real tenants, (b) they're in different domains/services, proving the registry isn't accidentally HR-specific or Sales-specific, (c) neither is currently mid-migration or ambiguous (unlike, say, `inventory.batch.enabled`-style flags whose status just changed this session — see `multi-industry-platform/02-gap-analysis.md` G8's correction — safer to let that settle before registering it as a capability). Expanding the registry to more capabilities is explicit future work (the "Phase 2 (future)" row in `00-roadmap-analysis.md`'s renumbering table), one entry per PR as real routes adopt `requireCapability`.
