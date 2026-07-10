import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy(
    {},
    { get: (_t, prop) => ({ columnName: String(prop) }) }
  );
  return { sagaLog: mockTable, createDatabaseClient: vi.fn() };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: { columnName: string }, b: unknown) => ({ type: 'eq', col: a.columnName, val: b })),
  and: vi.fn((...args: Array<{ type: string; col?: string; val?: unknown }>) => ({ type: 'and', args })),
}));

import { SagaOrchestrator, SagaExecutionError, type SagaStepDefinition } from '../saga.js';
import type { ErpDatabase } from '@erp/db';

interface Cond { type: string; col?: string; val?: unknown; args?: Cond[] }

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.type === 'and') return (cond.args ?? []).every((c) => matches(row, c));
  return row[cond.col!] === cond.val;
}

function makeFakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  const db = {
    rows,
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        rows.push({ id: rows.length + 1, status: 'STARTED', currentStep: 0, stepHistory: [], error: null, ...v });
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          rows.filter((r) => matches(r, cond)).forEach((r) => Object.assign(r, patch));
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: Cond) => ({
          limit: (_n: number) => Promise.resolve(rows.filter((r) => matches(r, cond))),
        }),
      }),
    }),
  };
  return db as unknown as ErpDatabase & { rows: typeof rows };
}

interface TestCtx {
  log: string[];
  failStep?: string;
}

function makeSteps(): SagaStepDefinition<TestCtx>[] {
  return [
    {
      name: 'stepA',
      type: 'COMPENSATABLE',
      execute: async (ctx) => {
        if (ctx.failStep === 'stepA') throw new Error('stepA boom');
        ctx.log.push('A-executed');
      },
      compensate: async (ctx) => {
        ctx.log.push('A-compensated');
      },
    },
    {
      name: 'stepB',
      type: 'COMPENSATABLE',
      execute: async (ctx) => {
        if (ctx.failStep === 'stepB') throw new Error('stepB boom');
        ctx.log.push('B-executed');
      },
      compensate: async (ctx) => {
        ctx.log.push('B-compensated');
      },
    },
    {
      name: 'stepC',
      type: 'IRREVERSIBLE',
      execute: async (ctx) => {
        if (ctx.failStep === 'stepC') throw new Error('stepC boom');
        ctx.log.push('C-executed');
      },
    },
  ];
}

describe('SagaOrchestrator', () => {
  it('happy path: runs all steps and persists COMPLETED with full step history', async () => {
    const db = makeFakeDb();
    const orchestrator = new SagaOrchestrator(db);
    const context: TestCtx = { log: [] };

    const result = await orchestrator.run({
      sagaType: 'TEST_SAGA',
      tenantId: 1,
      correlationId: 'corr-1',
      steps: makeSteps(),
      context,
    });

    expect(result.status).toBe('COMPLETED');
    expect(context.log).toEqual(['A-executed', 'B-executed', 'C-executed']);

    const row = db.rows.find((r) => r['sagaId'] === result.sagaId)!;
    expect(row['status']).toBe('COMPLETED');
    expect(row['currentStep']).toBe(3);
    expect((row['stepHistory'] as unknown[]).every((s: unknown) => (s as { status: string }).status === 'SUCCESS')).toBe(true);
  });

  it('compensation: a failed COMPENSATABLE step triggers compensate() on all prior succeeded COMPENSATABLE steps, in reverse order', async () => {
    const db = makeFakeDb();
    const orchestrator = new SagaOrchestrator(db);
    const context: TestCtx = { log: [], failStep: 'stepB' };

    await expect(
      orchestrator.run({
        sagaType: 'TEST_SAGA',
        tenantId: 1,
        correlationId: 'corr-2',
        steps: makeSteps(),
        context,
      })
    ).rejects.toBeInstanceOf(SagaExecutionError);

    // stepA executed then got compensated; stepB failed; stepC never ran
    expect(context.log).toEqual(['A-executed', 'A-compensated']);

    const row = db.rows.find((r) => r['tenantId'] === 1)!;
    expect(row['status']).toBe('COMPENSATED');
  });

  it('IRREVERSIBLE step failure does NOT trigger automatic compensation — saga is left FAILED for manual review', async () => {
    const db = makeFakeDb();
    const orchestrator = new SagaOrchestrator(db);
    const context: TestCtx = { log: [], failStep: 'stepC' };

    const result = await orchestrator.run({
      sagaType: 'TEST_SAGA',
      tenantId: 1,
      correlationId: 'corr-3',
      steps: makeSteps(),
      context,
    });

    // A and B ran and succeeded but were NOT compensated (irreversible-step failures need a human)
    expect(context.log).toEqual(['A-executed', 'B-executed']);
    expect(result.status).toBe('FAILED');

    const row = db.rows.find((r) => r['sagaId'] === result.sagaId)!;
    expect(row['status']).toBe('FAILED');
  });

  it('retry(): resumes from the failed step via the registered factory, not from scratch', async () => {
    // IRREVERSIBLE-step failure is the retriable case: A and B succeeded (not
    // compensated, per spec), stepC failed, saga is left FAILED — a human/operator
    // can retry once whatever caused stepC to fail is resolved.
    const db = makeFakeDb();
    const orchestrator = new SagaOrchestrator(db);
    const context: TestCtx = { log: [], failStep: 'stepC' };

    const first = await orchestrator.run({
      sagaType: 'RETRY_SAGA',
      tenantId: 5,
      correlationId: 'corr-4',
      payload: { marker: 'abc' },
      steps: makeSteps(),
      context,
    });

    expect(first.status).toBe('FAILED');
    const sagaRow = db.rows.find((r) => r['tenantId'] === 5)!;
    expect(sagaRow['currentStep']).toBe(2); // stepA + stepB succeeded before stepC failed

    // Register a factory that reconstructs steps (this time without the induced failure)
    // and a fresh context — proving retry() rebuilds from persisted state, not a live closure.
    orchestrator.register('RETRY_SAGA', async (payload) => {
      expect(payload).toEqual({ marker: 'abc' });
      const freshContext: TestCtx = { log: [] };
      return { steps: makeSteps(), context: freshContext };
    });

    const second = await orchestrator.retry(sagaRow['sagaId'] as string, 5);
    expect(second.status).toBe('COMPLETED');

    // Resumed from currentStep=2 — stepA/stepB must NOT re-run, only stepC
    const updatedRow = db.rows.find((r) => r['sagaId'] === sagaRow['sagaId'])!;
    expect(updatedRow['status']).toBe('COMPLETED');
    const history = updatedRow['stepHistory'] as Array<{ name: string }>;
    expect(history.map((h) => h.name)).toEqual(['stepA', 'stepB', 'stepC', 'stepC']);
  });

  it('retry() throws SAGA_TYPE_NOT_REGISTERED when no factory is registered for the saga type', async () => {
    const db = makeFakeDb();
    const orchestrator = new SagaOrchestrator(db);
    const context: TestCtx = { log: [], failStep: 'stepC' };

    await orchestrator.run({
      sagaType: 'UNREGISTERED_SAGA',
      tenantId: 9,
      correlationId: 'corr-5',
      steps: makeSteps(),
      context,
    });

    const sagaRow = db.rows.find((r) => r['tenantId'] === 9)!;
    await expect(orchestrator.retry(sagaRow['sagaId'] as string, 9)).rejects.toMatchObject({ code: 'SAGA_TYPE_NOT_REGISTERED' });
  });
});
