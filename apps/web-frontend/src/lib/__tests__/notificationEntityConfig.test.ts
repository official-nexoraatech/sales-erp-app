import { describe, it, expect } from 'vitest';
import {
  resolveNotificationRoute,
  getNotificationClickRoute,
} from '../notificationEntityConfig.js';
import type { InAppNotification } from '../../api/endpoints.js';

function makeNotification(overrides: Partial<InAppNotification> = {}): InAppNotification {
  return {
    id: 1,
    subject: 'Test',
    body: 'Test body',
    createdAt: new Date().toISOString(),
    readAt: null,
    entityType: null,
    entityId: null,
    priority: null,
    businessCategory: null,
    metadata: null,
    ...overrides,
  };
}

describe('resolveNotificationRoute', () => {
  it('resolves a detail-page entity to its id-based route', () => {
    const route = resolveNotificationRoute(
      makeNotification({ entityType: 'Invoice', entityId: 42 })
    );
    expect(route).toBe('/sales/invoices/42');
  });

  it('resolves a list-only entity (no detail page) to its list route, ignoring entityId', () => {
    const route = resolveNotificationRoute(
      makeNotification({ entityType: 'PurchaseOrder', entityId: 999 })
    );
    expect(route).toBe('/purchase/orders');
  });

  it('returns undefined for an entityType with no known destination', () => {
    const route = resolveNotificationRoute(
      makeNotification({ entityType: 'Expense', entityId: 1 })
    );
    expect(route).toBeUndefined();
  });

  it('returns undefined when entityType is missing entirely', () => {
    const route = resolveNotificationRoute(makeNotification({ entityType: null }));
    expect(route).toBeUndefined();
  });

  it('returns undefined for a detail-page entity missing its entityId', () => {
    const route = resolveNotificationRoute(
      makeNotification({ entityType: 'Invoice', entityId: null })
    );
    expect(route).toBeUndefined();
  });
});

describe('getNotificationClickRoute', () => {
  it('routes APPROVAL notifications to My Approvals regardless of entityType', () => {
    const route = getNotificationClickRoute(
      makeNotification({ businessCategory: 'APPROVAL', entityType: 'PurchaseOrder', entityId: 1 })
    );
    expect(route).toBe('/my-approvals');
  });

  it('falls back to entity resolution for non-APPROVAL notifications', () => {
    const route = getNotificationClickRoute(
      makeNotification({ businessCategory: 'SALES', entityType: 'Invoice', entityId: 7 })
    );
    expect(route).toBe('/sales/invoices/7');
  });

  it('carries the workflow instanceId from metadata so My Approvals can auto-select the item', () => {
    const route = getNotificationClickRoute(
      makeNotification({
        businessCategory: 'APPROVAL',
        entityType: 'Leave',
        metadata: { instanceId: 42, nodeId: 'node_1' },
      })
    );
    expect(route).toBe('/my-approvals?instanceId=42');
  });
});
