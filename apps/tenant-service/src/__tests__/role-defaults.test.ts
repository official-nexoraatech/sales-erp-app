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

// Multi-vertical platform audit 2026-08-16, Phase 2: the roadmap's "grocery role set" example
// — a single-store supervisor combining till/promotion/local-stock authority CASHIER alone
// doesn't have, while deliberately not reaching into catalog/procurement config
// (INVENTORY_MANAGER/PURCHASE_MANAGER-only).
describe('ROLE_DEFAULTS — STORE_MANAGER', () => {
  it('combines POS supervisory access with store-local stock adjustment and promotion authoring', () => {
    const perms = ROLE_DEFAULTS['STORE_MANAGER'] ?? [];
    expect(perms).toContain(PERMISSIONS.POS_MANAGE);
    expect(perms).toContain(PERMISSIONS.STOCK_ADJUST);
    expect(perms).toContain(PERMISSIONS.PROMOTION_MANAGE);
    expect(perms).toContain(PERMISSIONS.DISCOUNT_OVERRIDE);
  });

  it('does not hold catalog-master or procurement permissions reserved for specialist roles', () => {
    const perms = ROLE_DEFAULTS['STORE_MANAGER'] ?? [];
    expect(perms).not.toContain(PERMISSIONS.CATEGORY_CREATE);
    expect(perms).not.toContain(PERMISSIONS.PO_CREATE);
  });
});
