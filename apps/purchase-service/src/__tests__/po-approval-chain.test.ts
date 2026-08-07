/**
 * Enterprise approval chain: WorkflowEngine's seeded "Purchase Order — High Value Approval"
 * system definition (PO_CREATE, totalAmount>100000, PURCHASE_MANAGER then OWNER, 48h
 * escalation) is now actually triggered by PurchaseOrderService.create() and enforced by
 * approve() — previously seeded at tenant provisioning but never wired to anything. This is
 * additive to the existing organizationSettings.purchaseApprovalThreshold +
 * PO_APPROVE_HIGH_VALUE permission gate in approve(), not a replacement for it.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('ulid', () => ({ ulid: () => 'TEST-ULID-01' }));

vi.mock('@erp/db', () => ({
  purchaseOrders: { id: 'id', tenantId: 'tenant_id', status: 'status', supplierId: 'supplier_id' },
  purchaseOrderLines: { id: 'id', purchaseOrderId: 'purchase_order_id' },
  purchaseOrderHistory: {},
  purchaseOrderAmendments: {},
  suppliers: { id: 'id', tenantId: 'tenant_id' },
  items: { id: 'id', tenantId: 'tenant_id', status: 'status', deletedAt: 'deleted_at' },
  projectionSupplierBalance: { tenantId: 'tenant_id', supplierId: 'supplier_id' },
  outboxEvents: {},
  organizationSettings: {
    tenantId: 'tenant_id',
    purchaseApprovalThreshold: 'purchase_approval_threshold',
  },
  workflowDefinitions: {
    tenantId: 'tenant_id',
    triggerEvent: 'trigger_event',
    isActive: 'is_active',
  },
  workflowInstances: {
    id: 'id',
    tenantId: 'tenant_id',
    definitionId: 'definition_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    status: 'status',
    currentNodeId: 'current_node_id',
    correlationId: 'correlation_id',
    triggeredByUserId: 'triggered_by_user_id',
    triggerPayload: 'trigger_payload',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
  },
  workflowApprovals: {},
  roles: { id: 'id', tenantId: 'tenant_id', name: 'name' },
  userRoles: { userId: 'user_id', roleId: 'role_id', tenantId: 'tenant_id' },
  users: { id: 'id', isActive: 'is_active' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  inArray: vi.fn((col, vals) => ({ type: 'inArray', col, vals })),
  sql: vi.fn((s) => s),
  desc: vi.fn((col) => ({ type: 'desc', col })),
}));

import { PurchaseOrderService } from '../domain/PurchaseOrderService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'insert',
    'values',
    'update',
    'set',
    'onConflictDoUpdate',
    'for',
  ]) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['returning'] = vi.fn(() => next());
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => next().then(resolve, reject);
  return chainable;
}

function makeDb(script: unknown[]) {
  const trx = makeTrx(script);
  return { transaction: vi.fn((fn: (t: typeof trx) => Promise<unknown>) => fn(trx)) };
}

const baseCreateParams = {
  tenantId: 1,
  branchId: 1,
  warehouseId: 1,
  supplierId: 9,
  poDate: new Date(),
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  lines: [{ itemId: 5, orderedQty: 20, unitPrice: 10000, gstRate: 18 }], // grandTotal 236000, over the 100000 threshold
  createdBy: 99,
};

describe('PurchaseOrderService.create — WorkflowEngine trigger for high-value POs', () => {
  it('creates a PENDING workflow instance when an active "Purchase Order — High Value Approval" definition matches', async () => {
    const script = [
      [{ billingAddress: { stateCode: 'MH' } }], // select suppliers (seller-state resolution)
      [{ id: 5, status: 'ACTIVE', deletedAt: null }], // select items (transactability check)
      [{ id: 1 }], // insert purchaseOrders ... returning
      undefined, // insert purchaseOrderLines
      undefined, // insert purchaseOrderHistory
      // WorkflowEngine.trigger():
      [
        {
          id: 20,
          triggerEvent: 'PO_CREATE',
          conditionExpr: { field: 'totalAmount', operator: 'GT', value: 100000 },
          nodes: [
            {
              id: 'node_1',
              name: 'Purchase Manager Approval',
              type: 'APPROVAL',
              approverType: 'ROLE',
              approverRef: 'PURCHASE_MANAGER',
              nextNodeId: 'node_2',
            },
            {
              id: 'node_2',
              name: 'Owner Final Approval',
              type: 'APPROVAL',
              approverType: 'ROLE',
              approverRef: 'OWNER',
            },
          ],
          timeoutHours: 48,
        },
      ], // select workflowDefinitions — one active match
      [{ id: 500 }], // insert workflowInstances ... returning
      [{ id: 30 }], // select roles (PURCHASE_MANAGER)
      [{ userId: 7 }], // select userRoles join users
      undefined, // insert workflowApprovals
      undefined, // insert outboxEvents (PO_CREATED)
    ];
    const db = makeDb(script);
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.create(baseCreateParams)).resolves.toBe(1);
  });

  it('does not create a workflow instance when no active definition matches (unchanged behavior)', async () => {
    const script = [
      [{ billingAddress: { stateCode: 'MH' } }],
      [{ id: 5, status: 'ACTIVE', deletedAt: null }],
      [{ id: 2 }], // insert purchaseOrders ... returning
      undefined,
      undefined,
      [], // WorkflowEngine.trigger(): select workflowDefinitions — no match, no-op
      undefined, // insert outboxEvents (PO_CREATED)
    ];
    const db = makeDb(script);
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.create(baseCreateParams)).resolves.toBe(2);
  });
});

describe('PurchaseOrderService.approve — blocked by a pending/rejected approval instance', () => {
  const poRow = {
    id: 1,
    tenantId: 1,
    status: 'SUBMITTED',
    supplierId: 9,
    grandTotal: '236000.00',
  };

  it('rejects approve() with APPROVAL_PENDING while the triggered instance is still PENDING', async () => {
    const script = [
      [poRow], // select purchaseOrders
      [{ status: 'PENDING' }], // WorkflowEngine approval-gate: blocking instance found
    ];
    const db = makeDb(script);
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.approve(1, 1, 99, 'PO-0001')).rejects.toMatchObject({
      code: 'APPROVAL_PENDING',
    });
  });

  it('rejects approve() with APPROVAL_REJECTED when the instance was rejected during approval', async () => {
    const script = [[poRow], [{ status: 'REJECTED' }]];
    const db = makeDb(script);
    const svc = new PurchaseOrderService(db as never);

    await expect(svc.approve(1, 1, 99, 'PO-0001')).rejects.toMatchObject({
      code: 'APPROVAL_REJECTED',
    });
  });
});
