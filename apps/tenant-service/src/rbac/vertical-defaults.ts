export type TenantVertical = 'CLOTH_RETAIL' | 'GROCERY';

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
    featureFlagOverrides: [],
  },
  GROCERY: {
    excludeRoles: [],
    featureFlagOverrides: [{ key: 'hr.tailoring.enabled', enabled: false }],
  },
};
