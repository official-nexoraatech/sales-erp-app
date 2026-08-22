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
  importJobs: {
    status: 'status',
    createdAt: 'created_at',
    id: 'id',
    s3Key: 's3_key',
    errorReportS3Key: 'error_report_s3_key',
  },
  exportJobs: {
    status: 'status',
    signedUrlExpiresAt: 'signed_url_expires_at',
    id: 'id',
    s3Key: 's3_key',
  },
  workflowInstances: {
    tenantId: 'tenant_id',
    status: 'status',
    expiresAt: 'expires_at',
    id: 'id',
    definitionId: 'definition_id',
    currentNodeId: 'current_node_id',
  },
  workflowDefinitions: { id: 'id', escalationUserId: 'escalation_user_id', nodes: 'nodes' },
  workflowApprovals: {
    tenantId: 'tenant_id',
    action: 'action',
    id: 'id',
    instanceId: 'instance_id',
    nodeId: 'node_id',
    reminderCount: 'reminder_count',
  },
  financialEntries: {},
  tenants: { id: 'id', contactEmail: 'contact_email' },
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

  const db = {
    selectResults,
    executeResults,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(selectResults[selectIndex++] ?? [])),
      })),
    })),
    // RLS-readiness follow-up (2026-08-22): withTenantConnection's own SET LOCAL call also
    // goes through this same execute() — swallow that one specifically (by SQL-text match, sql
    // is mocked above to return {strings, values}) rather than letting it consume a slot meant
    // for a real job query, which would silently shift every subsequent result off by one.
    execute: vi.fn((query?: { strings?: string[] }) => {
      if (query?.strings?.some((s) => s.includes('set_config'))) return Promise.resolve([]);
      return Promise.resolve(executeResults[executeIndex++] ?? []);
    }),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    // Several jobs now go through withTenantConnection, which calls pooledDb.transaction(async
    // trx => { await trx.execute(...); return fn(trx); }) — the mock runs the callback against
    // itself, same identity pattern used elsewhere in this rollout's test-mock fixes.
    transaction: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn(db)),
    ...overrides,
  };
  return db;
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
      'accounting.trial-balance.snapshot',
      'accounting.outstanding-report',
      'accounting.bank-reconciliation-reminder',
      'inventory.low-stock-alert',
      'inventory.stock-value-report',
      'inventory.physical-verification-reminder',
      'gst.gstr1-auto-prepare',
      'gst.gstr3b-reminder',
      'gst.gstr2a-reconcile',
      'hr.payroll.prepare',
      'hr.salary-slip.email',
      'sales.credit-limit-review',
      'purchase.po-delivery-reminder',
      'purchase.pending-grn-alert',
      'workflow.approval-expiry',
      'workflow.approval-reminder',
      'platform.outbox-cleanup',
      'platform.audit-log-archive',
      'platform.token-cleanup',
      'platform.partition-maintenance',
      'platform.import-cleanup',
      'platform.notification-log-archive',
      'platform.export-cleanup',
    ];
    for (const name of expectedJobs) {
      expect(registry.handlers.has(name)).toBe(true);
    }
  });

  it('accounting.trial-balance.snapshot calls the internal endpoint and does nothing when tenantId is undefined', async () => {
    const registry = buildFakeRegistry();
    registerSystemJobs(registry as never, buildFakeDb() as never, buildFakeStorage() as never);

    const fetchMock = vi.fn(async () =>
      jsonResponse({ isBalanced: true, totalDebit: 100, totalCredit: 100 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('accounting.trial-balance.snapshot')!({}, undefined);
    expect(fetchMock).not.toHaveBeenCalled();

    await registry.handlers.get('accounting.trial-balance.snapshot')!({}, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/internal/reports/trial-balance-snapshot?tenantId=5');
  });

  it('accounting.zero-value-journal-audit emails the tenant contact when a journal posted zero value on every line', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([
      {
        journal_id: '01JZERO000000000000000001',
        reference_type: 'EXPENSE',
        reference_id: 42,
        posted_at: '2026-07-30T10:00:00Z',
      },
    ]);
    db.selectResults.push([{ contactEmail: 'finance@example.com' }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn(async () => jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('accounting.zero-value-journal-audit')!({}, 9);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [notifyUrl, notifyOptions] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(notifyUrl).toContain('/notifications/send-raw-internal');
    expect(JSON.parse(notifyOptions.body)).toMatchObject({
      tenantId: 9,
      channel: 'EMAIL',
      recipientEmail: 'finance@example.com',
      eventType: 'ZERO_VALUE_JOURNAL_DETECTED',
    });
    expect(JSON.parse(notifyOptions.body).body).toContain('EXPENSE #42');
  });

  it('accounting.zero-value-journal-audit sends no notification when no zero-value journals are found', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('accounting.zero-value-journal-audit')!({}, 9);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accounting.zero-value-journal-audit does nothing when tenantId is undefined', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('accounting.zero-value-journal-audit')!({}, undefined);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('gst.ledger-completeness-audit emails the tenant contact when a ledger row has a missing/inconsistent tax rate', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([
      {
        id: 101,
        entry_type: 'PURCHASE',
        document_number: 'GRN-QA-RCM-1',
        source_document_type: 'GRN',
        source_document_id: 55,
      },
    ]);
    db.selectResults.push([{ contactEmail: 'finance@example.com' }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn(async () => jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('gst.ledger-completeness-audit')!({}, 9);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [notifyUrl, notifyOptions] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(notifyUrl).toContain('/notifications/send-raw-internal');
    expect(JSON.parse(notifyOptions.body)).toMatchObject({
      tenantId: 9,
      channel: 'EMAIL',
      recipientEmail: 'finance@example.com',
      eventType: 'GST_LEDGER_INCOMPLETE_ROW_DETECTED',
    });
    expect(JSON.parse(notifyOptions.body).body).toContain('GRN-QA-RCM-1');
  });

  it('gst.ledger-completeness-audit sends no notification when every ledger row is complete', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('gst.ledger-completeness-audit')!({}, 9);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gst.ledger-completeness-audit does nothing when tenantId is undefined', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('gst.ledger-completeness-audit')!({}, undefined);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('sales.payment-reminder-ladder skips the tenant entirely when not opted in', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([{ payment_reminder_enabled: false }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('sales.payment-reminder-ladder')!({}, 9);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sales.payment-reminder-ladder does nothing when tenantId is undefined', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('sales.payment-reminder-ladder')!({}, undefined);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('sales.payment-reminder-ladder sends no notification when there are no overdue invoices', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([{ payment_reminder_enabled: true }]); // settings
    db.executeResults.push([]); // overdue invoices
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('sales.payment-reminder-ladder')!({}, 9);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sales.payment-reminder-ladder sends the correct un-sent stage per invoice and skips already-sent stages', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([{ payment_reminder_enabled: true }]); // settings
    db.executeResults.push([
      // 2 days overdue -> DAY_0 due, not yet sent
      {
        id: 1,
        invoice_number: 'INV-001',
        balance_due: '5000',
        customer_email: 'a@example.com',
        customer_name: 'Alice',
        days_overdue: 2,
      },
      // 10 days overdue, DAY_0 already sent -> DAY_7 due
      {
        id: 2,
        invoice_number: 'INV-002',
        balance_due: '3000',
        customer_email: 'b@example.com',
        customer_name: 'Bob',
        days_overdue: 10,
      },
      // 40 days overdue, nothing sent yet -> DAY_30 due (not a backfill of 0/7/15)
      {
        id: 3,
        invoice_number: 'INV-003',
        balance_due: '9000',
        customer_email: 'c@example.com',
        customer_name: 'Cara',
        days_overdue: 40,
      },
      // 5 days overdue, DAY_0 already sent, 5 < 7 -> nothing due yet
      {
        id: 4,
        invoice_number: 'INV-004',
        balance_due: '1000',
        customer_email: 'd@example.com',
        customer_name: 'Dev',
        days_overdue: 5,
      },
    ]); // overdue invoices
    db.executeResults.push([
      { invoice_id: 2, stage: 'DAY_0' },
      { invoice_id: 4, stage: 'DAY_0' },
    ]); // already-sent log rows
    db.selectResults.push([{ contactEmail: 'owner@example.com' }]); // tenant contact, for the DAY_30 escalation
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn(async () => jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('sales.payment-reminder-ladder')!({}, 9);

    // INV-001 (DAY_0), INV-002 (DAY_7), INV-003 (DAY_30) + 1 escalation email for INV-003's
    // DAY_30 = 4 notification sends. INV-004 gets nothing (5 days overdue, DAY_0 already sent,
    // next threshold is 7).
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const bodies = fetchMock.mock.calls.map(([, opts]: [string, { body: string }]) =>
      JSON.parse(opts.body)
    );

    const inv1 = bodies.find((b) => b.recipientEmail === 'a@example.com');
    expect(inv1).toMatchObject({ eventType: 'PAYMENT_REMINDER', recipientEmail: 'a@example.com' });

    const inv2 = bodies.find((b) => b.recipientEmail === 'b@example.com');
    expect(inv2).toMatchObject({ eventType: 'PAYMENT_REMINDER', recipientEmail: 'b@example.com' });

    const inv3 = bodies.find((b) => b.recipientEmail === 'c@example.com');
    expect(inv3).toMatchObject({ eventType: 'PAYMENT_REMINDER', recipientEmail: 'c@example.com' });

    const escalation = bodies.find((b) => b.eventType === 'PAYMENT_REMINDER_ESCALATION');
    expect(escalation).toMatchObject({ recipientEmail: 'owner@example.com' });
    expect(escalation.body).toContain('INV-003');

    expect(
      bodies.some((b: { recipientEmail?: string }) => b.recipientEmail === 'd@example.com')
    ).toBe(false);
  });

  it('inventory.low-stock-alert reuses production-service reorder-required and never throws on failure', async () => {
    const registry = buildFakeRegistry();
    registerSystemJobs(registry as never, buildFakeDb() as never, buildFakeStorage() as never);

    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      registry.handlers.get('inventory.low-stock-alert')!({}, 5)
    ).resolves.toBeUndefined();

    const fetchMock = vi.fn(async () => jsonResponse([{ itemCode: 'X' }, { itemCode: 'Y' }]));
    global.fetch = fetchMock as unknown as typeof fetch;
    await registry.handlers.get('inventory.low-stock-alert')!({}, 5);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/internal/inventory/reorder-required?tenantId=5');
  });

  it('inventory.near-expiry-alert calls the internal endpoint and never throws on failure', async () => {
    const registry = buildFakeRegistry();
    registerSystemJobs(registry as never, buildFakeDb() as never, buildFakeStorage() as never);

    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      registry.handlers.get('inventory.near-expiry-alert')!({}, undefined)
    ).resolves.toBeUndefined();

    const fetchMock = vi.fn(async () => jsonResponse({ checked: 3, alertsPublished: 1 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await registry.handlers.get('inventory.near-expiry-alert')!({}, undefined);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method?: string }];
    expect(url).toContain('/inventory/near-expiry-alert');
    expect(init.method).toBe('POST');
  });

  it('production.reorder-report emails the tenant contact once when items are below reorder level', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([{ contactEmail: 'finance@example.com' }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ itemCode: 'X', name: 'Widget' }]))
      .mockResolvedValueOnce(jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('production.reorder-report')!({}, 9);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [notifyUrl, notifyOptions] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(notifyUrl).toContain('/notifications/send-raw-internal');
    expect(JSON.parse(notifyOptions.body)).toMatchObject({
      tenantId: 9,
      channel: 'EMAIL',
      recipientEmail: 'finance@example.com',
      eventType: 'REORDER_REPORT',
    });
  });

  it('production.reorder-report also sends an IN_APP notification to every user holding REORDER_CREATE_PO', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([{ contactEmail: 'finance@example.com' }]);
    db.executeResults.push([{ id: 42 }, { id: 43 }]); // two users hold REORDER_CREATE_PO
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ itemCode: 'X', name: 'Widget' }])) // GET reorder-required
      .mockResolvedValue(jsonResponse({})); // every notify POST after that
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('production.reorder-report')!({}, 9);

    // 1 GET + 1 EMAIL notify + 2 IN_APP notifies (one per recipient) = 4
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const inAppCalls = fetchMock.mock.calls
      .slice(2)
      .map(([, opts]: [string, { body: string }]) => JSON.parse(opts.body));
    expect(inAppCalls).toHaveLength(2);
    expect(inAppCalls.map((c: { recipientUserId: number }) => c.recipientUserId).sort()).toEqual([
      42, 43,
    ]);
    for (const call of inAppCalls) {
      expect(call).toMatchObject({ tenantId: 9, channel: 'IN_APP', eventType: 'REORDER_REPORT' });
    }
  });

  it('production.reorder-report sends no IN_APP notifications when no one holds REORDER_CREATE_PO', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([{ contactEmail: 'finance@example.com' }]);
    db.executeResults.push([]); // no recipients
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ itemCode: 'X', name: 'Widget' }]))
      .mockResolvedValue(jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('production.reorder-report')!({}, 9);

    // 1 GET + 1 EMAIL notify only — no IN_APP calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('production.job-work-overdue-alert emails the tenant contact when orders are in progress', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([{ contactEmail: 'ops@example.com' }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ orderNumber: 'JW-1' }]))
      .mockResolvedValueOnce(jsonResponse({}));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('production.job-work-overdue-alert')!({}, 9);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [notifyUrl, notifyOptions] = fetchMock.mock.calls[1] as [string, { body: string }];
    expect(notifyUrl).toContain('/notifications/send-raw-internal');
    expect(JSON.parse(notifyOptions.body)).toMatchObject({
      tenantId: 9,
      channel: 'EMAIL',
      recipientEmail: 'ops@example.com',
      eventType: 'JOB_WORK_OVERDUE_ALERT',
    });
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

  it('platform.partition-maintenance issues a CREATE TABLE ... PARTITION OF for next year, then enables+forces RLS on the new partition', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.executeResults.push([], [], []);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    await registry.handlers.get('platform.partition-maintenance')!({}, undefined);
    // RLS-readiness follow-up (2026-08-22): a fresh partition doesn't inherit the parent's
    // ENABLE/FORCE ROW LEVEL SECURITY flags — CREATE TABLE ... PARTITION OF, then
    // ALTER TABLE ... ENABLE ROW LEVEL SECURITY, then ALTER TABLE ... FORCE ROW LEVEL SECURITY.
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('workflow.approval-reminder sends a real IN_APP notification per pending approval and increments reminderCount', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    db.selectResults.push([
      { id: 101, nodeName: 'Manager Approval', approverId: 7, instanceId: 501 },
      { id: 102, nodeName: 'Finance Approval', approverId: 8, instanceId: 502 },
    ]);
    db.selectResults.push([{ entityType: 'EXPENSE', entityId: 501 }]);
    db.selectResults.push([{ entityType: 'PURCHASE_ORDER', entityId: 502 }]);
    registerSystemJobs(registry as never, db as never, buildFakeStorage() as never);

    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await registry.handlers.get('workflow.approval-reminder')!({}, 9);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('/notifications/send-raw-internal');
    expect(JSON.parse(options.body)).toMatchObject({
      tenantId: 9,
      channel: 'IN_APP',
      recipientUserId: 7,
      eventType: 'WORKFLOW_APPROVAL_REMINDER',
    });
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
