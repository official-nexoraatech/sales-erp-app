export type TenantVertical = 'CLOTH_RETAIL' | 'GROCERY' | 'DISTRIBUTION' | 'MANUFACTURING';

// Per-vertical provisioning template — selects which ROLE_DEFAULTS entries and which
// feature-flag overrides TenantProvisioner seeds for a new tenant, mirroring the same
// seed-template-copy pattern already used for ROLE_DEFAULTS and planEntitlements.
//
// Multi-vertical platform audit 2026-08-16: excludeRoles/featureFlagOverrides are empty
// for CLOTH_RETAIL (today's unchanged behavior) and only disable the one cloth-specific
// feature flag (hr.tailoring.enabled, globally defaulted to true — see
// apps/hr-service/src/api/internal.routes.ts) for GROCERY. Populate further as
// vertical-specific roles/flags are built (see ERP-PLANNING grocery roadmap Phase 2).
export interface VerticalDefaults {
  excludeRoles: string[];
  featureFlagOverrides: Array<{ key: string; enabled: boolean }>;
}

export const VERTICAL_DEFAULTS: Record<TenantVertical, VerticalDefaults> = {
  CLOTH_RETAIL: {
    excludeRoles: [],
    featureFlagOverrides: [
      { key: 'pos.enabled', enabled: true },
      { key: 'hr.payroll.enabled', enabled: true },
    ],
  },
  GROCERY: {
    excludeRoles: [],
    featureFlagOverrides: [
      { key: 'hr.tailoring.enabled', enabled: false },
      { key: 'pos.enabled', enabled: true },
      { key: 'hr.payroll.enabled', enabled: true },
    ],
  },
  // Distribution vertical, Phase A (ERP-PLANNING/DISTRIBUTION-ROADMAP) — confirmed 2026-08-20:
  // POS off (wholesale is the default; a retail counter is an optional operating model, opt-in
  // per tenant), hr.payroll.enabled on (still runs its own staff payroll), inventory.batch.enabled
  // on (strong fit for distributor lot/expiry traceability across a dealer network).
  DISTRIBUTION: {
    excludeRoles: [],
    featureFlagOverrides: [
      { key: 'pos.enabled', enabled: false },
      { key: 'hr.payroll.enabled', enabled: true },
      { key: 'inventory.batch.enabled', enabled: true },
    ],
  },
  // Manufacturing vertical, Phase A (ERP-PLANNING/multi-industry-platform, Phase 12 review) —
  // POS off (a factory isn't a retail counter), hr.payroll.enabled on (runs its own shop-floor
  // staff payroll), manufacturing.bom.enabled on (the core capability this vertical exists for).
  MANUFACTURING: {
    excludeRoles: [],
    featureFlagOverrides: [
      { key: 'pos.enabled', enabled: false },
      { key: 'hr.payroll.enabled', enabled: true },
      { key: 'manufacturing.bom.enabled', enabled: true },
      // Manufacturing vertical, Phase B — Work Centers, on by default alongside BOM.
      { key: 'manufacturing.work_centers.enabled', enabled: true },
      // Manufacturing vertical — standalone Production Order (in-house manufacturing, distinct
      // from Job Work Order's outsourced-to-a-supplier model), on by default alongside BOM.
      { key: 'manufacturing.production_order.enabled', enabled: true },
      // Manufacturing vertical — Routing, on by default alongside Production Order.
      { key: 'manufacturing.routing.enabled', enabled: true },
      // Manufacturing vertical — MRP, on by default; requires BOM + PRODUCTION_ORDER (see
      // capability-registry.ts's MRP.requires), both already on above.
      { key: 'manufacturing.mrp.enabled', enabled: true },
    ],
  },
};
