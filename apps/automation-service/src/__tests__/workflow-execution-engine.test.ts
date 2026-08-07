import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => ({
  workflowExecutionHistory: {
    id: 'id',
    tenantId: 'tenant_id',
    definitionId: 'definition_id',
  },
}));

vi.mock('@erp/sdk', () => ({
  evaluateConditions: vi.fn(
    (
      conditions: Array<{ field: string; operator: string; value: unknown }>,
      operator: 'AND' | 'OR',
      data: Record<string, unknown>
    ) => {
      const evalOne = (c: { field: string; operator: string; value: unknown }) => {
        const actual = data[c.field];
        if (c.operator === 'EQUALS') return actual == c.value;
        if (c.operator === 'GREATER_THAN') return Number(actual) > Number(c.value);
        return false;
      };
      if (conditions.length === 0) return true;
      return operator === 'AND' ? conditions.every(evalOne) : conditions.some(evalOne);
    }
  ),
}));

import { WorkflowExecutionEngine } from '../domain/WorkflowExecutionEngine.js';
import type { WorkflowDefinition, WorkflowNode } from '@erp/db';

function makeDb(historyRow: { id: number } = { id: 1 }) {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const chainable: Record<string, unknown> = {};
  for (const m of ['insert', 'values', 'update', 'set', 'where']) {
    chainable[m] = vi.fn(() => chainable);
  }
  chainable['insert'] = vi.fn(() => chainable);
  chainable['values'] = vi.fn((v: unknown) => {
    inserted.push(v);
    return chainable;
  });
  chainable['returning'] = vi.fn(() => Promise.resolve([historyRow]));
  chainable['update'] = vi.fn(() => chainable);
  chainable['set'] = vi.fn((v: unknown) => {
    updated.push(v);
    return chainable;
  });
  return { db: chainable, inserted, updated };
}

function makeDefinition(nodes: WorkflowNode[]): WorkflowDefinition {
  return {
    id: 1,
    tenantId: 1,
    name: 'test',
    triggerEvent: 'TEST_EVENT',
    entityType: 'Test',
    conditionExpr: { field: '', operator: 'ALWAYS' },
    nodes,
    isActive: true,
    isSystem: false,
    timeoutHours: 48,
    escalationUserId: null,
    triggerType: 'EVENT',
    triggerConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 1,
    version: 0,
  } as unknown as WorkflowDefinition;
}

describe('WorkflowExecutionEngine.execute', () => {
  it('runs a CONDITION -> ACTION chain and publishes the action event when the condition passes', async () => {
    const { db, updated } = makeDb();
    const notifier = { notifyRole: vi.fn(), notifyUser: vi.fn() };
    const publisher = { publish: vi.fn() };
    const engine = new WorkflowExecutionEngine(db as never, notifier, publisher);

    const definition = makeDefinition([
      {
        id: 'n1',
        name: 'Check amount',
        type: 'CONDITION',
        conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 100 }],
        conditionOperator: 'AND',
        nextNodeId: 'n2',
      },
      { id: 'n2', name: 'Publish', type: 'ACTION', actionEventType: 'CUSTOM_AUTOMATION_FIRED' },
    ]);

    await engine.execute(definition, { amount: 500 }, 'EVENT');

    expect(publisher.publish).toHaveBeenCalledWith(1, 'CUSTOM_AUTOMATION_FIRED', { amount: 500 });
    const finalUpdate = updated[updated.length - 1] as { status: string; nodeResults: unknown[] };
    expect(finalUpdate.status).toBe('COMPLETED');
    expect(finalUpdate.nodeResults).toHaveLength(2);
  });

  it('stops at a failing CONDITION node and does not execute the following ACTION node', async () => {
    const { db } = makeDb();
    const notifier = { notifyRole: vi.fn(), notifyUser: vi.fn() };
    const publisher = { publish: vi.fn() };
    const engine = new WorkflowExecutionEngine(db as never, notifier, publisher);

    const definition = makeDefinition([
      {
        id: 'n1',
        name: 'Check amount',
        type: 'CONDITION',
        conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 1000 }],
        conditionOperator: 'AND',
        nextNodeId: 'n2',
      },
      { id: 'n2', name: 'Publish', type: 'ACTION', actionEventType: 'CUSTOM_AUTOMATION_FIRED' },
    ]);

    await engine.execute(definition, { amount: 50 }, 'EVENT');

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('notifies a role for a NOTIFICATION node', async () => {
    const { db } = makeDb();
    const notifier = { notifyRole: vi.fn(), notifyUser: vi.fn() };
    const publisher = { publish: vi.fn() };
    const engine = new WorkflowExecutionEngine(db as never, notifier, publisher);

    const definition = makeDefinition([
      {
        id: 'n1',
        name: 'Notify manager',
        type: 'NOTIFICATION',
        approverType: 'ROLE',
        approverRef: 'SALES_MANAGER',
        message: 'Heads up',
      },
    ]);

    await engine.execute(definition, {}, 'MANUAL');

    expect(notifier.notifyRole).toHaveBeenCalledWith(1, 'SALES_MANAGER', 'Heads up');
  });

  it('fails loudly (not a silent truncation) when nextNodeId references a step that does not exist', async () => {
    const { db, updated } = makeDb();
    const notifier = { notifyRole: vi.fn(), notifyUser: vi.fn() };
    const publisher = { publish: vi.fn() };
    const engine = new WorkflowExecutionEngine(db as never, notifier, publisher);

    const definition = makeDefinition([
      {
        id: 'n1',
        name: 'Notify',
        type: 'NOTIFICATION',
        message: 'hi',
        nextNodeId: 'does-not-exist',
      },
    ]);

    await engine.execute(definition, {}, 'EVENT');

    const finalUpdate = updated[updated.length - 1] as { status: string; errorMessage?: string };
    expect(finalUpdate.status).toBe('FAILED');
    expect(finalUpdate.errorMessage).toMatch(/does-not-exist/);
  });

  it('fails loudly if it encounters an APPROVAL node (owned by WorkflowEngine, not this engine)', async () => {
    const { db, updated } = makeDb();
    const notifier = { notifyRole: vi.fn(), notifyUser: vi.fn() };
    const publisher = { publish: vi.fn() };
    const engine = new WorkflowExecutionEngine(db as never, notifier, publisher);

    const definition = makeDefinition([
      { id: 'n1', name: 'Approve', type: 'APPROVAL', approverType: 'ROLE', approverRef: 'OWNER' },
    ]);

    await engine.execute(definition, {}, 'EVENT');

    const finalUpdate = updated[updated.length - 1] as { status: string };
    expect(finalUpdate.status).toBe('FAILED');
  });
});
