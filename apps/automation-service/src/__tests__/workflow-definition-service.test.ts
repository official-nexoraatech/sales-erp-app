import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  workflowDefinitions: {
    id: 'id',
    tenantId: 'tenant_id',
    isSystem: 'is_system',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
  desc: vi.fn((c) => c),
}));

import { WorkflowDefinitionService } from '../domain/WorkflowDefinitionService.js';

function makeTrx(script: unknown[]) {
  let i = 0;
  const next = () => Promise.resolve(script[i++]);
  const chainable: Record<string, unknown> = {};
  for (const m of [
    'select',
    'from',
    'where',
    'orderBy',
    'insert',
    'values',
    'update',
    'set',
    'delete',
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

const baseInput = {
  name: 'Test automation',
  triggerEvent: 'INVOICE_CONFIRMED',
  entityType: 'Invoice',
  triggerType: 'EVENT' as const,
  nodes: [{ id: 'n1', name: 'Notify', type: 'NOTIFICATION' as const, message: 'hi' }],
  isActive: true,
};

describe('WorkflowDefinitionService', () => {
  it('creates a new tenant-authored definition (isSystem=false)', async () => {
    const db = makeTrx([[{ id: 10, isSystem: false, name: baseInput.name }]]);
    const svc = new WorkflowDefinitionService(db as never);

    const row = await svc.create(1, 99, baseInput);
    expect(row).toMatchObject({ id: 10 });
    const valuesCall = (db.values as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      isSystem: boolean;
    };
    expect(valuesCall.isSystem).toBe(false);
  });

  it('refuses to delete a system definition', async () => {
    const db = makeTrx([[{ id: 5, tenantId: 1, isSystem: true }]]);
    const svc = new WorkflowDefinitionService(db as never);

    await expect(svc.remove(5, 1)).rejects.toMatchObject({ code: 'WORKFLOW_SYSTEM' });
  });

  it('allows deleting a non-system definition', async () => {
    const db = makeTrx([[{ id: 6, tenantId: 1, isSystem: false }], undefined]);
    const svc = new WorkflowDefinitionService(db as never);

    await expect(svc.remove(6, 1)).resolves.toBeUndefined();
  });
});
