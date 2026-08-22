import { describe, it, expect } from 'vitest';
import {
  CAPABILITY_REGISTRY,
  getCapabilityDefinition,
  type CapabilityDefinition,
} from '@erp/types';

// Known-real feature flag keys, cross-checked against the actual seed list in
// apps/tenant-service/src/domain/TenantProvisioner.ts's seedFeatureFlags() — the flags
// every tenant is provisioned with. A registry entry whose flagKey isn't in this list
// would be describing a flag nothing ever seeds, which is a documentation-consistency
// bug worth catching at test time (see 03-capability-registry.md §3).
const KNOWN_REAL_FLAG_KEYS = [
  'pos.enabled',
  'multi-branch.enabled',
  'inventory.variants.enabled',
  'sales.quotations.enabled',
  'sales.credit-limit.enabled',
  'accounting.auto-journal.enabled',
  'gst.e-invoice.enabled',
  'gst.eway-bill.enabled',
  'hr.payroll.enabled',
  'hr.attendance.enabled',
  'notification.whatsapp.enabled',
  'notification.email.enabled',
  'notification.sms.enabled',
  'import.bulk.enabled',
  'audit.detailed.enabled',
  // Phase 2B (INVENTORY_BATCH): deliberately NOT in TenantProvisioner's per-tenant seed list —
  // every tenant inherits this flag's value from the global (tenant_id IS NULL) default row
  // seeded by migration 0169_inventory_batch_capability.sql instead (see
  // 10-entitlement-impact.md §2). Still a known-real, currently-seeded flag, just seeded once
  // globally rather than once per tenant.
  'inventory.batch.enabled',
  // Manufacturing vertical, Phase A (BOM) — seeded via VERTICAL_DEFAULTS.MANUFACTURING's
  // featureFlagOverrides in apps/tenant-service/src/rbac/vertical-defaults.ts.
  'manufacturing.bom.enabled',
  // Manufacturing vertical, Phase B (Work Centers) — same seed path as BOM above.
  'manufacturing.work_centers.enabled',
  // Manufacturing vertical — standalone Production Order — same seed path as BOM above.
  'manufacturing.production_order.enabled',
  // Manufacturing vertical — Routing — same seed path as BOM above.
  'manufacturing.routing.enabled',
  // Manufacturing vertical — MRP — same seed path as BOM above.
  'manufacturing.mrp.enabled',
];

// Walks the `requires` graph for cycles — used both against the real registry (should
// never find one) and against synthetic fixtures below (should detect an injected one).
function findCycle(registry: Record<string, CapabilityDefinition>): boolean {
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const key of Object.keys(registry)) color.set(key, WHITE);

  function visit(key: string): boolean {
    color.set(key, GRAY);
    const def = registry[key];
    if (def) {
      for (const dep of def.requires) {
        const depColor = color.get(dep);
        if (depColor === GRAY) return true; // back-edge -> cycle
        if (depColor === WHITE && visit(dep)) return true;
      }
    }
    color.set(key, BLACK);
    return false;
  }

  for (const key of Object.keys(registry)) {
    if (color.get(key) === WHITE && visit(key)) return true;
  }
  return false;
}

describe('CAPABILITY_REGISTRY', () => {
  it('has exactly 8 entries in this phase (BOM, HR_PAYROLL, INVENTORY_BATCH, MRP, POS, PRODUCTION_ORDER, ROUTING, WORK_CENTERS)', () => {
    expect(Object.keys(CAPABILITY_REGISTRY).sort()).toEqual([
      'BOM',
      'HR_PAYROLL',
      'INVENTORY_BATCH',
      'MRP',
      'POS',
      'PRODUCTION_ORDER',
      'ROUTING',
      'WORK_CENTERS',
    ]);
  });

  it('every entry key matches its own `key` field', () => {
    for (const [registryKey, def] of Object.entries(CAPABILITY_REGISTRY)) {
      expect(def.key).toBe(registryKey);
    }
  });

  it('every entry has a unique key (no duplicates)', () => {
    const keys = Object.values(CAPABILITY_REGISTRY).map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry's flagKey matches a known-real, currently-seeded feature flag", () => {
    for (const def of Object.values(CAPABILITY_REGISTRY)) {
      expect(KNOWN_REAL_FLAG_KEYS).toContain(def.flagKey);
    }
  });

  it('no entry requires itself', () => {
    for (const def of Object.values(CAPABILITY_REGISTRY)) {
      expect(def.requires).not.toContain(def.key);
    }
  });

  it('the real registry has no dependency cycle', () => {
    expect(findCycle(CAPABILITY_REGISTRY)).toBe(false);
  });

  it('detects a cycle in a synthetic 2-node fixture (A requires B, B requires A)', () => {
    const cyclic: Record<string, CapabilityDefinition> = {
      A: {
        key: 'A',
        name: 'A',
        domain: 'Test',
        owningService: 'test-service',
        flagKey: 'test.a.enabled',
        requires: ['B'],
        status: 'GA',
        applicableBusinessTypes: [],
        permissions: [],
      },
      B: {
        key: 'B',
        name: 'B',
        domain: 'Test',
        owningService: 'test-service',
        flagKey: 'test.b.enabled',
        requires: ['A'],
        status: 'GA',
        applicableBusinessTypes: [],
        permissions: [],
      },
    };
    expect(findCycle(cyclic)).toBe(true);
  });

  it('getCapabilityDefinition returns the matching entry', () => {
    expect(getCapabilityDefinition('POS')?.flagKey).toBe('pos.enabled');
  });

  it('getCapabilityDefinition returns the INVENTORY_BATCH entry', () => {
    const def = getCapabilityDefinition('INVENTORY_BATCH');
    expect(def?.flagKey).toBe('inventory.batch.enabled');
    expect(def?.owningService).toBe('inventory-service');
    expect(def?.permissions).toEqual(['BATCH_VIEW', 'BATCH_CONFIGURE']);
  });

  it('getCapabilityDefinition returns undefined for an unregistered key', () => {
    expect(getCapabilityDefinition('NOT_A_REAL_CAPABILITY')).toBeUndefined();
  });
});
