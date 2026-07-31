import { describe, it, expect, vi, afterEach } from 'vitest';

// Column-reference proxy (same pattern as saga.test.ts's mockTable) — any property access
// on schemaRegistryTable returns a stand-in the mocked eq()/desc() can read a column name off.
vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) });
  return { schemaRegistryTable: mockTable };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: { columnName: string }, b: unknown) => ({ type: 'eq', col: a.columnName, val: b })),
  desc: vi.fn((a: { columnName: string }) => ({ type: 'desc', col: a.columnName })),
}));

import {
  SchemaRegistry,
  SchemaCompatibilityError,
  getUpcaster,
  upcastEvent,
  type JsonSchema,
} from '../schema-registry.js';
import type { TenantScopedDatabase } from '../database.js';

interface EqCond {
  type: 'eq';
  col: string;
  val: unknown;
}
interface DescCond {
  type: 'desc';
  col: string;
}

function matches(row: Record<string, unknown>, cond: EqCond): boolean {
  return row[cond.col] === cond.val;
}

// Minimal thenable query-builder stand-in: each chain method returns a new node closing
// over the accumulated filter/order/limit state, and the node itself is awaitable
// regardless of where the real code stops chaining (getCatalog awaits straight off
// orderBy() with no .limit(), getLatest/getVersion go all the way to .limit()).
function makeFakeDb() {
  let autoRegisteredAt = 0;
  const rows: Array<Record<string, unknown>> = [];

  function chain(state: { where?: EqCond; orderCol?: string; limit?: number }) {
    const node = {
      from: () => chain(state),
      where: (cond: EqCond) => chain({ ...state, where: cond }),
      orderBy: (d: DescCond) => chain({ ...state, orderCol: d.col }),
      limit: (n: number) => chain({ ...state, limit: n }),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        try {
          let result = state.where ? rows.filter((r) => matches(r, state.where!)) : rows.slice();
          if (state.orderCol) {
            const col = state.orderCol;
            result = [...result].sort((a, b) => (b[col] as number) - (a[col] as number));
          }
          if (state.limit !== undefined) result = result.slice(0, state.limit);
          resolve(result);
        } catch (e) {
          reject?.(e);
        }
      },
    };
    return node;
  }

  const raw = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        rows.push({
          description: null,
          registeredBy: null,
          registeredAt: autoRegisteredAt++,
          ...v,
        });
        return Promise.resolve();
      },
    }),
    select: () => chain({}),
  };

  return { raw, rows } as unknown as TenantScopedDatabase & { rows: typeof rows };
}

function schema(props: Record<string, string>, required: string[] = []): JsonSchema {
  return {
    type: 'object',
    required,
    properties: Object.fromEntries(Object.entries(props).map(([k, t]) => [k, { type: t }])),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SchemaRegistry.register / getLatest / getVersion', () => {
  it('registers the first version of an event type with no prior compatibility check', async () => {
    const db = makeFakeDb();
    const registry = new SchemaRegistry(db);

    const entry = await registry.register({
      eventType: 'ORDER_CREATED_T1',
      schemaVersion: 1,
      jsonSchema: schema({ orderId: 'integer' }, ['orderId']),
      compatibilityMode: 'BACKWARD',
    });

    expect(entry.schemaVersion).toBe(1);
    const latest = await registry.getLatest('ORDER_CREATED_T1');
    expect(latest?.schemaVersion).toBe(1);
  });

  it('getVersion returns a specific historical version, not just the latest', async () => {
    const db = makeFakeDb();
    const registry = new SchemaRegistry(db);

    await registry.register({
      eventType: 'ORDER_CREATED_T2',
      schemaVersion: 1,
      jsonSchema: schema({ orderId: 'integer' }),
      compatibilityMode: 'NONE',
    });
    await registry.register({
      eventType: 'ORDER_CREATED_T2',
      schemaVersion: 2,
      jsonSchema: schema({ orderId: 'integer', branchId: 'integer' }),
      compatibilityMode: 'NONE',
    });

    const v1 = await registry.getVersion('ORDER_CREATED_T2', 1);
    const v2 = await registry.getVersion('ORDER_CREATED_T2', 2);
    const latest = await registry.getLatest('ORDER_CREATED_T2');

    expect(v1?.schemaVersion).toBe(1);
    expect(v2?.schemaVersion).toBe(2);
    expect(latest?.schemaVersion).toBe(2);
  });

  it('getLatest/getVersion return null for an unknown event type or version', async () => {
    const db = makeFakeDb();
    const registry = new SchemaRegistry(db);

    expect(await registry.getLatest('NEVER_REGISTERED')).toBeNull();

    await registry.register({
      eventType: 'ORDER_CREATED_T3',
      schemaVersion: 1,
      jsonSchema: schema({}),
      compatibilityMode: 'NONE',
    });
    expect(await registry.getVersion('ORDER_CREATED_T3', 99)).toBeNull();
  });

  it('rejects registering a BACKWARD-incompatible new version and does not persist it', async () => {
    const db = makeFakeDb();
    const registry = new SchemaRegistry(db);

    await registry.register({
      eventType: 'INVOICE_X',
      schemaVersion: 1,
      jsonSchema: schema({ invoiceId: 'integer' }, ['invoiceId']),
      compatibilityMode: 'BACKWARD',
    });

    await expect(
      registry.register({
        eventType: 'INVOICE_X',
        schemaVersion: 2,
        // new required field not present in v1 — a v1-shaped payload would fail v2 validation
        jsonSchema: schema({ invoiceId: 'integer', branchId: 'integer' }, [
          'invoiceId',
          'branchId',
        ]),
        compatibilityMode: 'BACKWARD',
      })
    ).rejects.toThrow(SchemaCompatibilityError);

    const latest = await registry.getLatest('INVOICE_X');
    expect(latest?.schemaVersion).toBe(1); // v2 was never persisted
  });

  it('L1 cache: getLatest served from cache does not re-query until register() invalidates it', async () => {
    const db = makeFakeDb();
    const registry = new SchemaRegistry(db);
    await registry.register({
      eventType: 'CACHE_T1',
      schemaVersion: 1,
      jsonSchema: schema({}),
      compatibilityMode: 'NONE',
    });
    await registry.getLatest('CACHE_T1'); // primes the cache (register() itself doesn't cache on a first-ever version, since its internal pre-check finds no existing row to cache)

    const selectSpy = vi.spyOn(db.raw, 'select');
    await registry.getLatest('CACHE_T1');
    await registry.getLatest('CACHE_T1');
    expect(selectSpy).not.toHaveBeenCalled(); // both served from cache

    await registry.register({
      eventType: 'CACHE_T1',
      schemaVersion: 2,
      jsonSchema: schema({}),
      compatibilityMode: 'NONE',
    });
    const latest = await registry.getLatest('CACHE_T1');
    expect(latest?.schemaVersion).toBe(2); // invalidated by register(), reflects the new version
  });

  it('L1 cache expires after its TTL and re-fetches from the DB', async () => {
    const db = makeFakeDb();
    const registry = new SchemaRegistry(db);
    await registry.register({
      eventType: 'CACHE_TTL_T1',
      schemaVersion: 1,
      jsonSchema: schema({}),
      compatibilityMode: 'NONE',
    });

    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(realNow);
    await registry.getLatest('CACHE_TTL_T1'); // primes the cache at "now"

    const selectSpy = vi.spyOn(db.raw, 'select');
    nowSpy.mockReturnValue(realNow + 61_000); // past the 60s TTL
    await registry.getLatest('CACHE_TTL_T1');
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SchemaRegistry.checkCompatibility', () => {
  const registry = new SchemaRegistry(makeFakeDb());

  it('mode NONE is always compatible regardless of breaking changes', () => {
    const result = registry.checkCompatibility(
      schema({ a: 'string' }, ['a']),
      schema({ b: 'string' }, ['b']),
      'NONE'
    );
    expect(result).toEqual({ compatible: true, incompatibilities: [] });
  });

  it('BACKWARD: flags a new required field absent from the old schema', () => {
    const result = registry.checkCompatibility(
      schema({ a: 'string' }),
      schema({ a: 'string', b: 'string' }, ['b']),
      'BACKWARD'
    );
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain("New required field 'b'");
  });

  it('BACKWARD: flags a changed field type', () => {
    const result = registry.checkCompatibility(
      schema({ a: 'string' }),
      schema({ a: 'integer' }),
      'BACKWARD'
    );
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain("type changed from 'string' to 'integer'");
  });

  it('BACKWARD: adding a new optional field is compatible', () => {
    const result = registry.checkCompatibility(
      schema({ a: 'string' }),
      schema({ a: 'string', b: 'string' }),
      'BACKWARD'
    );
    expect(result).toEqual({ compatible: true, incompatibilities: [] });
  });

  it('FORWARD: flags removal of a field that was required in the old schema', () => {
    const result = registry.checkCompatibility(
      schema({ a: 'string', b: 'string' }, ['a', 'b']),
      schema({ a: 'string' }),
      'FORWARD'
    );
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities[0]).toContain(
      "Field 'b' was required in old schema but removed"
    );
  });

  it('FULL: applies both BACKWARD and FORWARD checks', () => {
    const result = registry.checkCompatibility(
      schema({ a: 'string', b: 'string' }, ['a', 'b']),
      schema({ a: 'string', c: 'string' }, ['a', 'c']),
      'FULL'
    );
    expect(result.compatible).toBe(false);
    expect(result.incompatibilities.length).toBeGreaterThanOrEqual(2); // b removed (FORWARD) + c new-required (BACKWARD)
  });
});

describe('SchemaRegistry.validate', () => {
  const registry = new SchemaRegistry(makeFakeDb());

  it('flags a missing required field', () => {
    const errors = registry.validate('X', schema({ a: 'string' }, ['a']), {});
    expect(errors).toEqual(['Missing required field: a']);
  });

  it('flags a type mismatch on a present field', () => {
    const errors = registry.validate('X', schema({ a: 'integer' }), { a: 'not-a-number' });
    expect(errors[0]).toContain("expected type 'integer'");
  });

  it('passes a valid payload with no errors', () => {
    const errors = registry.validate('X', schema({ a: 'integer', b: 'string' }, ['a']), {
      a: 1,
      b: 'ok',
    });
    expect(errors).toEqual([]);
  });
});

describe('upcastEvent / getUpcaster', () => {
  it('has no upcaster registered for an arbitrary event type', () => {
    expect(getUpcaster('SOME_RANDOM_EVENT', 1, 2)).toBeNull();
  });

  it('applies the registered INVOICE_CONFIRMED v1->v2 upcaster', () => {
    const result = upcastEvent('INVOICE_CONFIRMED', 1, 2, { invoiceId: 5 });
    expect(result).toEqual({
      invoiceId: 5,
      branchId: 1,
      metadata: { upcasted: true, originalVersion: 1 },
    });
  });

  it('returns the payload unchanged when no upcaster exists for the requested hop', () => {
    const result = upcastEvent('UNKNOWN_EVENT_TYPE', 1, 3, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });
});
