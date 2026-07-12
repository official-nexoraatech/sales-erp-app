import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '@erp/types';
import { ROLE_DEFAULTS } from '../rbac/role-defaults.js';

// Regression test for a QA-session finding (2026-07-12): SALES_MANAGER granted
// QUOTATION_VIEW/CREATE/UPDATE/CANCEL but never QUOTATION_CONVERT — the one permission
// POST /quotations/:id/convert actually checks — so the role meant to run the sales
// workflow could never perform its final conversion step. Confirmed live: zero SALES_MANAGER
// roles across 5 existing tenants had it; backfilled via migration 0051.
describe('ROLE_DEFAULTS — SALES_MANAGER', () => {
  it('grants QUOTATION_CONVERT alongside the other quotation permissions', () => {
    const perms = ROLE_DEFAULTS['SALES_MANAGER'] ?? [];
    expect(perms).toContain(PERMISSIONS.QUOTATION_VIEW);
    expect(perms).toContain(PERMISSIONS.QUOTATION_CREATE);
    expect(perms).toContain(PERMISSIONS.QUOTATION_CONVERT);
  });
});
