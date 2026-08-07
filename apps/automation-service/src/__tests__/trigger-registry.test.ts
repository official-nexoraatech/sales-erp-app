/**
 * TriggerRegistry: dispatches EVENT/CRON/MANUAL/API triggers into WorkflowExecutionEngine,
 * but must skip any definition whose first node is an APPROVAL/PARALLEL_APPROVAL chain — those
 * remain WorkflowEngine's (triggered directly by the owning domain service), not this engine's.
 * A bug here would mean automation-service silently double-runs an approval chain, or silently
 * drops a real automation trigger.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  workflowDefinitions: {
    id: 'id',
    tenantId: 'tenant_id',
    triggerEvent: 'trigger_event',
    triggerType: 'trigger_type',
    isActive: 'is_active',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ type: 'and', args })),
  eq: vi.fn((col, val) => ({ type: 'eq', col, val })),
}));

import { TriggerRegistry } from '../domain/TriggerRegistry.js';

function makeDb(rows: unknown[]) {
  const chainable: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where']) {
    chainable[m] = vi.fn(() => chainable);
  }
  (chainable as { then: unknown })['then'] = (
    resolve: (v: unknown) => void,
    reject: (e: unknown) => void
  ) => Promise.resolve(rows).then(resolve, reject);
  return chainable;
}

function makeEngine() {
  return { execute: vi.fn().mockResolvedValue(undefined) };
}

const automationDef = {
  id: 1,
  tenantId: 1,
  triggerEvent: 'INVOICE_CONFIRMED',
  triggerType: 'EVENT',
  isActive: true,
  nodes: [{ id: 'n1', type: 'NOTIFICATION', message: 'hi' }],
};

const approvalDef = {
  id: 2,
  tenantId: 1,
  triggerEvent: 'INVOICE_CREATE',
  triggerType: 'EVENT',
  isActive: true,
  nodes: [{ id: 'n1', type: 'APPROVAL', approverType: 'ROLE', approverRef: 'OWNER' }],
};

const parallelApprovalDef = {
  ...approvalDef,
  id: 3,
  nodes: [{ id: 'n1', type: 'PARALLEL_APPROVAL', approverType: 'ROLE', approverRef: 'OWNER' }],
};

describe('TriggerRegistry.handleEvent', () => {
  it('executes an automation-chain definition matching the event', async () => {
    const db = makeDb([automationDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleEvent(1, 'INVOICE_CONFIRMED', { invoiceId: 7 });

    expect(engine.execute).toHaveBeenCalledWith(automationDef, { invoiceId: 7 }, 'EVENT');
  });

  it("skips an APPROVAL-chain definition — that is WorkflowEngine's responsibility, not this engine's", async () => {
    const db = makeDb([approvalDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleEvent(1, 'INVOICE_CREATE', {});

    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('skips a PARALLEL_APPROVAL-chain definition for the same reason', async () => {
    const db = makeDb([parallelApprovalDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleEvent(1, 'INVOICE_CREATE', {});

    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('runs every matching automation definition when several are active for the same event', async () => {
    const second = { ...automationDef, id: 5 };
    const db = makeDb([automationDef, second]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleEvent(1, 'INVOICE_CONFIRMED', {});

    expect(engine.execute).toHaveBeenCalledTimes(2);
  });

  it('does not let one failing definition stop the others from running (isolated per-definition failure)', async () => {
    const second = { ...automationDef, id: 5 };
    const db = makeDb([automationDef, second]);
    const engine = {
      execute: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined),
    };
    const registry = new TriggerRegistry(db as never, engine as never);

    await expect(registry.handleEvent(1, 'INVOICE_CONFIRMED', {})).resolves.toBeUndefined();

    expect(engine.execute).toHaveBeenCalledTimes(2);
  });

  it('no-ops when no active definition matches the event', async () => {
    const db = makeDb([]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleEvent(1, 'SOME_UNMATCHED_EVENT', {});

    expect(engine.execute).not.toHaveBeenCalled();
  });
});

describe('TriggerRegistry.handleCron', () => {
  it('executes the definition with an empty payload and CRON trigger label', async () => {
    const db = makeDb([automationDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleCron(1, 1);

    expect(engine.execute).toHaveBeenCalledWith(automationDef, {}, 'CRON');
  });

  it('no-ops when the definition no longer exists or is inactive', async () => {
    const db = makeDb([]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleCron(999, 1);

    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('skips an APPROVAL-chain definition even if somehow configured with a CRON trigger', async () => {
    const db = makeDb([approvalDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleCron(2, 1);

    expect(engine.execute).not.toHaveBeenCalled();
  });
});

describe('TriggerRegistry.handleManualOrApiTrigger', () => {
  it('executes with the supplied payload and MANUAL label', async () => {
    const db = makeDb([automationDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleManualOrApiTrigger(1, 1, { reason: 'ops test' }, 'MANUAL');

    expect(engine.execute).toHaveBeenCalledWith(automationDef, { reason: 'ops test' }, 'MANUAL');
  });

  it('executes with the API label for a signed public-trigger call', async () => {
    const db = makeDb([automationDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleManualOrApiTrigger(1, 1, {}, 'API');

    expect(engine.execute).toHaveBeenCalledWith(automationDef, {}, 'API');
  });

  it('no-ops when the definition does not belong to the calling tenant', async () => {
    const db = makeDb([]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleManualOrApiTrigger(1, 999, {}, 'MANUAL');

    expect(engine.execute).not.toHaveBeenCalled();
  });

  it('refuses to manually fire an APPROVAL-chain definition through the automation trigger endpoint', async () => {
    const db = makeDb([approvalDef]);
    const engine = makeEngine();
    const registry = new TriggerRegistry(db as never, engine as never);

    await registry.handleManualOrApiTrigger(2, 1, {}, 'MANUAL');

    expect(engine.execute).not.toHaveBeenCalled();
  });
});
