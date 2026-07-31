import { describe, it, expect } from 'vitest';
import { matchesRoutePattern, routeHasDynamicSegment } from '../routeMatch.js';

describe('routeHasDynamicSegment', () => {
  it('is false for a plain static route', () => {
    expect(routeHasDynamicSegment('sales/invoices')).toBe(false);
  });

  it('is true when any segment starts with a colon', () => {
    expect(routeHasDynamicSegment('sales/invoices/:id')).toBe(true);
  });
});

describe('matchesRoutePattern', () => {
  it('matches an exact static route the same way plain string equality used to', () => {
    expect(matchesRoutePattern('sales/invoices', '/sales/invoices')).toBe(true);
    expect(matchesRoutePattern('sales/invoices', '/sales/quotations')).toBe(false);
  });

  it('matches a dynamic segment against any real value in that position', () => {
    expect(matchesRoutePattern('sales/invoices/:id', '/sales/invoices/142')).toBe(true);
    expect(matchesRoutePattern('sales/invoices/:id', '/sales/invoices/new')).toBe(true);
  });

  it('rejects a different path shape even with a dynamic segment present', () => {
    expect(matchesRoutePattern('sales/invoices/:id', '/sales/invoices')).toBe(false);
    expect(matchesRoutePattern('sales/invoices/:id', '/sales/quotations/142')).toBe(false);
    expect(matchesRoutePattern('sales/invoices/:id', '/sales/invoices/142/edit')).toBe(false);
  });

  it('ignores a leading slash on either side', () => {
    expect(matchesRoutePattern('/sales/invoices/:id', 'sales/invoices/142')).toBe(true);
  });
});
