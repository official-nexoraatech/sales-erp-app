// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
// Mirrors apps/sales-service/src/domain/ApiKeyService.ts's PUBLIC_API_SCOPES — kept as a small
// hand-mirrored constant (not re-exported from a shared package) since no frontend-consumable
// package currently exports sales-service's domain-layer constants.
export const PUBLIC_API_SCOPES = [
  'leads:read',
  'opportunities:read',
  'accounts:read',
  'contacts:read',
] as const;
