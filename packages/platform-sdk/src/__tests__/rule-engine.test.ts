import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, {
    get: (_t, prop) => ({ columnName: String(prop) }),
  });
  return {
    businessRules: mockTable,
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
}));

import { RuleEngine } from '../rule-engine.js';

const BASE_RULE = {
  id: 'rule-1',
  tenantId: 1,
  name: 'Test Rule',
  entityType: 'SALE',
  eventType: 'SALE_CREATE',
  conditionOperator: 'AND',
  isActive: true,
  priority: 1,
};

function makeDb(rules: unknown[] = [], singleRule?: unknown) {
  const list = Object.assign(Promise.resolve(rules), { orderBy: vi.fn().mockResolvedValue(rules) });
  const single = Object.assign(Promise.resolve(singleRule ? [singleRule] : []), {
    limit: vi.fn().mockResolvedValue(singleRule ? [singleRule] : []),
  });
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          // Return single-item chain for .limit() calls, list for .orderBy()
          return Object.assign(Promise.resolve(singleRule ? [singleRule] : rules), {
            limit: vi.fn().mockResolvedValue(singleRule ? [singleRule] : []),
            orderBy: vi.fn().mockResolvedValue(rules),
          });
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('RuleEngine.evaluate', () => {
  it('returns blocked=true when BLOCK action triggers', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 10000 }], actions: [{ type: 'BLOCK', message: 'Over limit' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { amount: 15000 } });
    expect(result.blocked).toBe(true);
    expect(result.appliedRuleCount).toBe(1);
  });

  it('does not block when condition does not match', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 10000 }], actions: [{ type: 'BLOCK', message: 'Over limit' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { amount: 5000 } });
    expect(result.blocked).toBe(false);
    expect(result.appliedRuleCount).toBe(0);
  });

  it('collects SET_FIELD changes', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'discountPercent', operator: 'LESS_THAN_EQUALS', value: 5 }], actions: [{ type: 'SET_FIELD', field: 'autoApproved', value: true }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { discountPercent: 3 } });
    expect(result.fieldChanges['autoApproved']).toBe(true);
  });

  it('collects WARN messages', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'quantity', operator: 'LESS_THAN', value: 0 }], actions: [{ type: 'WARN', message: 'Negative quantity' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { quantity: -1 } });
    expect(result.warnings).toContain('Negative quantity');
  });

  it('evaluates OR condition correctly', async () => {
    const rules = [
      { ...BASE_RULE, conditionOperator: 'OR', conditions: [{ field: 'status', operator: 'EQUALS', value: 'DRAFT' }, { field: 'status', operator: 'EQUALS', value: 'PENDING' }], actions: [{ type: 'WARN', message: 'Not finalized' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { status: 'DRAFT' } });
    expect(result.warnings).toContain('Not finalized');
  });

  it('evaluates BETWEEN operator', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'amount', operator: 'BETWEEN', value: 1000, value2: 5000 }], actions: [{ type: 'SET_FIELD', field: 'tier', value: 'MEDIUM' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { amount: 3000 } });
    expect(result.fieldChanges['tier']).toBe('MEDIUM');
  });

  it('evaluates IN operator', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'mode', operator: 'IN', value: ['CASH', 'UPI'] }], actions: [{ type: 'SET_FIELD', field: 'fastTrack', value: true }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { mode: 'UPI' } });
    expect(result.fieldChanges['fastTrack']).toBe(true);
  });

  it('does not match IN when value not in list', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'mode', operator: 'IN', value: ['CASH', 'UPI'] }], actions: [{ type: 'BLOCK' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { mode: 'CREDIT' } });
    expect(result.blocked).toBe(false);
  });

  it('evaluates NOT_IN operator', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'status', operator: 'NOT_IN', value: ['CANCELLED', 'DRAFT'] }], actions: [{ type: 'SET_FIELD', field: 'canProcess', value: true }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { status: 'CONFIRMED' } });
    expect(result.fieldChanges['canProcess']).toBe(true);
  });

  it('evaluates CONTAINS operator (case-insensitive)', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'name', operator: 'CONTAINS', value: 'fabric' }], actions: [{ type: 'SET_FIELD', field: 'isFabric', value: true }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { name: 'Blue Fabric Roll' } });
    expect(result.fieldChanges['isFabric']).toBe(true);
  });

  it('evaluates STARTS_WITH operator', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'sku', operator: 'STARTS_WITH', value: 'FAB-' }], actions: [{ type: 'SET_FIELD', field: 'category', value: 'FABRIC' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { sku: 'FAB-001-BLUE' } });
    expect(result.fieldChanges['category']).toBe('FABRIC');
  });

  it('stops at BLOCK and skips lower-priority rules', async () => {
    const rules = [
      { ...BASE_RULE, priority: 1, conditions: [{ field: 'blocked', operator: 'EQUALS', value: true }], actions: [{ type: 'BLOCK', message: 'Blocked' }] },
      { ...BASE_RULE, id: 'rule-2', priority: 2, conditions: [{ field: 'blocked', operator: 'EQUALS', value: true }], actions: [{ type: 'SET_FIELD', field: 'afterBlock', value: true }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: { blocked: true } });
    expect(result.blocked).toBe(true);
    expect(result.fieldChanges['afterBlock']).toBeUndefined();
  });

  it('evaluates nested field with dot notation', async () => {
    const rules = [
      { ...BASE_RULE, conditions: [{ field: 'customer.creditLimitEnabled', operator: 'EQUALS', value: true }], actions: [{ type: 'WARN', message: 'Check credit' }] },
    ];
    const engine = new RuleEngine(makeDb(rules) as never);
    const result = await engine.evaluate({
      tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE',
      data: { customer: { creditLimitEnabled: true } },
    });
    expect(result.warnings).toContain('Check credit');
  });

  it('handles empty rules list gracefully', async () => {
    const engine = new RuleEngine(makeDb([]) as never);
    const result = await engine.evaluate({ tenantId: 1, entityType: 'SALE', eventType: 'SALE_CREATE', data: {} });
    expect(result.blocked).toBe(false);
    expect(result.appliedRuleCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('RuleEngine.simulate', () => {
  it('returns matched=true and condition results for matching data', async () => {
    const rule = { ...BASE_RULE, conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 5000 }], actions: [{ type: 'BLOCK', message: 'Blocked' }] };
    const db = makeDb([], rule);
    const engine = new RuleEngine(db as never);
    const result = await engine.simulate(1, 'rule-1', { amount: 8000 });
    expect(result.matched).toBe(true);
    expect(result.conditionResults[0]?.passed).toBe(true);
    expect(result.actions).toHaveLength(1);
  });

  it('returns matched=false for non-matching data', async () => {
    const rule = { ...BASE_RULE, conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 5000 }], actions: [{ type: 'BLOCK' }] };
    const db = makeDb([], rule);
    const engine = new RuleEngine(db as never);
    const result = await engine.simulate(1, 'rule-1', { amount: 1000 });
    expect(result.matched).toBe(false);
    expect(result.conditionResults[0]?.passed).toBe(false);
    expect(result.actions).toHaveLength(0);
  });
});
