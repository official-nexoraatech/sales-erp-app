/**
 * PG-026 — converts 23 previously log-only stub jobs in system-jobs.ts into real work.
 * This suite doesn't exercise all 23 individually (most just fetch an owning service's
 * internal endpoint and log the response — the same shape as the pre-existing "real" jobs
 * already covered by search-sync-jobs.test.ts) — it covers a representative sample per
 * category: fetch-based (accounting/inventory), direct-DB read+notify (workflow), and
 * direct-DB batched maintenance (platform.token-cleanup/partition-maintenance), plus the
 * tenantScoped `tenantId === undefined` guard that every converted job now has.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@erp/db', () => ({
  outboxEvents: { published: 'published', createdAt: 'created_at', id: 'id' },
  auditLog: { createdAt: 'created_at', id: 'id' },
  refreshTokens: { expiresAt: 'expires_at', id: 'id' },
  passwordResetTokens: { expiresAt: 'expires_at', id: 'id' },
  notificationLog: { createdAt: 'created_at', id: 'id' },
  importJobs: { status: 'status', createdAt: 'created_at', id: 'id', s3Key: 's3_key', errorReportS3Key: 'error_report_s3_key' },
  exportJobs: { status: 'status', signedUrlExpiresAt: 'signed_url_expires_at', id: 'id', s3Key: 's3_key' },
  workflowInstances: { tenantId: 'tenant_id', status: 'status', expiresAt: 'expires_at', id: 'id', definitionId: 'definition_id', currentNodeId: 'current_node_id' },
  workflowDefinitions: { id: 'id', escalationUserId: 'escalation_user_id', nodes: 'nodes' },
  workflowApprovals: { tenantId: 'tenant_id', action: 'action', id: 'id', instanceId: 'instance_id', nodeId: 'node_id', reminderCount: 'reminder_count' },
  financialEntries: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: 'and', conditions })),
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  lt: vi.fn((col: unknown, val: unknown) => ({ type: 'lt', col, val })),
  sql: Object.assign(
    vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn((s: string) => ({ type: 'raw', s })) }
  ),
}));

import { registerSystemJobs } from '../jobs/system-jobs.js';

type JobHandler = (job: unknown, tenantId?: number) => Promise<void>;

function buildFakeRegistry() {
  const handlers = new Map<string, JobHandler>();
  const configs = new Map<string, { tenantScoped: boolean }>();
  return {
    handlers,
    configs,
    register: vi.fn((name: string, config: { tenantScoped: boolean }, handler: JobHandler) => {
      handlers.set(name, handler);
      configs.set(name, config);
    }),
    listAll: vi.fn(() => Array.from(handlers.keys()).map((name) => ({ name }))),
  };
}

function buildFakeDb(overrides: Partial<Record<string, unknown>> = {}) {
  const selectResults: unknown[][] = [];
  let selectIndex = 0;
  const executeResults: unknown[][] = [];
  let executeIndex = 0;

  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
    then: undefined,
  };
  // Allow `await db.select(...).from(...).where(...)` without an explicit .limit() call too.
  Object.assign(chain, { [Symbol.for('nodejs.util.inspect.custom')]: undefined });

  return {
    selectResults,
    executeResults,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
      })),
    })),
    execute: vi.fn(() => Promise.resolve(executeResults[executeIndex++] ?? [])),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    ...overrides,
  };
}

function buildFakeStorage() {
  return {
    uploadFile: vi.fn(() => Promise.resolve('archives/fake-key.json')),
    deleteFile: vi.fn(() => Promise.resolve()),
    getSignedUrl: vi.fn(() => Promise.resolve('http://example/signed')),
  };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function jsonResponse(data: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => ({ data }) } as unknown as Response;
}

describe('registerSystemJobs', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = 'test-key';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('registers all 23 previously-stub jobs (still present, not accidentally dropped)', () => {
    const registry = buildFakeRegistry();
    registerSystemJobs(registry as never, buildFakeDb() as never, buildFakeStorage() as never);

    const expectedJobs = [
      'accounting.trial-balance.snapshot', 'accounting.outstanding-report', 'accounting.bank-reconciliation-reminder',
      'inventory.low-stock-alert', 'inventory.stock-value-report', 'inventory.physical-verification-reminder',
      'gst.gstr1-auto-prepare', 'gst.gstr3b-reminder', 'gst.gstr2a-reconcile',
      'hr.payroll.prepare', 'hr.salary-slip.email',
      'sales.credit-limit-review',
      'purchase.po-delivery-reminder', 'purchase.pending-grn-alert',
      'workflow.approval-expiry', 'workflow.approval-reminder',
      'platform.outbox-cleanup', 'platform.audit-log-archive', 'platform.token-cleanup',
      'platform.partition-maintenance', 'platform.import-cleanup', 'platform.notification-log-archive', 'platform.export-cleanup',
    ];
    for (const name of expectedJobs) {
      expect(registry.handlers.has(name)).toBe(true);
    }
  });

  it('accounting.trial-balance.snapshot calls the internal endpoint and does nothing when tenantId is undefined', async () => {
    const registry = buildFakeRegistry();
    registerSystemJobs(registry as never, buildFakeDb() as never, buildFakeStorage() as never);

    const fetchMock = vi.fn(async () => jsonResponse({ isBalanced: true, totalDebit: 100, totalCredit: 100 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('accounting.trial-balance.snapshot')!({}, undefined);
    expect(fetchMock).not.toHaveBeenCalled();

    await registry.handlers.get('accounting.trial-balance.snapshot')!({}, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/internal/reports/trial-balance-snapshot?tenantId=5');
  });

  it('inventory.low-stock-alert reuses production-service reorder-required and never throws on failure', async () => {
    const registry = buildFakeRegistry();
    registerSystemJobs(registry as never, buildFakeDb() as never, buildFakeStorage() as never);

    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(registry.handlers.get('inventory.low-stock-alert')!({}, 5)).resolves.toBeUndefined();

    const fetchMock = vi.fn(async () => jsonResponse([{ itemCode: 'X' }, { itemCode: 'Y' }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await registry.handlers.get('inventory.low-stock-alert')!({}, 5);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/internal/inventory/reorder-required?tenantId=5');
  });

  it('platform.token-cleanup batches deletes and stops once a batch returns fewer than the batch size', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    // First refresh-token batch full (keeps looping), second batch short (stops).
    db.executeResults.push(new Array(5000).fill({ id: 1 }), new Array(10).fill({ id: 1 }));
    // password-reset-token batch: short immediately.
    db.executeResults.push(new Array(3).fill({ id: 1 }));
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('platform.token-cleanup')!({}, undefined);
    // 2 calls to drain refresh tokens (5000 then 10) + 1 call for password reset tokens.
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('platform.partition-maintenance issues a CREATE TABLE ... PARTITION OF for next year', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('platform.partition-maintenance')!({}, undefined);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('workflow.approval-reminder increments reminderCount for every pending approval in the tenant', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([{ id: 101 }, { id: 102 }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('workflow.approval-reminder')!({}, 9);
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('workflow.approval-expiry expires an instance with no escalation target configured', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([{ id: 1, definitionId: 50, currentNodeId: 'node_1' }]); // overdue instances
    db.selectResults.push([{ id: 50, escalationUserId: null, nodes: [] }]); // its definition, no escalation target
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('workflow.approval-expiry')!({}, 9);
    // Should update workflowInstances to EXPIRED, not insert a new escalated approval.
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
