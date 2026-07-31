// CRM-ROADMAP Phase 1, Feature 6 (DLT/TRAI SMS Compliance) — the hard, blocking gate in
// NotificationEngine.sendRaw: a promotional SMS that doesn't match any registered, active,
// non-expired DLT template is rejected (not silently skipped, not sent with a warning); a
// matching promotional SMS succeeds; and every existing transactional caller (category
// omitted) is completely unaffected regardless of what templates are registered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@erp/db', () => {
  const makeTable = (name: string) =>
    new Proxy({}, { get: (_t, prop) => ({ __table: name, columnName: String(prop) }) });
  return {
    notificationLog: makeTable('notificationLog'),
    crmDltTemplates: makeTable('crmDltTemplates'),
    featureFlags: makeTable('featureFlags'),
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
  lt: vi.fn((_a: unknown, _b: unknown) => '__lt__'),
  gte: vi.fn((_a: unknown, _b: unknown) => '__gte__'),
}));

vi.mock('handlebars', () => ({
  default: { compile: vi.fn().mockReturnValue((_data: unknown) => 'compiled-body') },
}));

import { NotificationEngine } from '../domain/NotificationEngine.js';
import { crmDltTemplates } from '@erp/db';
import { BusinessError } from '@erp/types';
import { matchesDltTemplate } from '@erp/utils';

describe('matchesDltTemplate — pure matching logic', () => {
  it('matches a message with variables substituted into a multi-variable pattern', () => {
    expect(
      matchesDltTemplate(
        'Dear Ramesh, your order ORD1234 has been shipped.',
        'Dear {#var#}, your order {#var#} has been shipped.'
      )
    ).toBe(true);
  });

  it('rejects a message with different literal (non-variable) text', () => {
    expect(
      matchesDltTemplate(
        'Hello Ramesh, your parcel ORD1234 has left the warehouse.',
        'Dear {#var#}, your order {#var#} has been shipped.'
      )
    ).toBe(false);
  });

  it('correctly escapes regex-special characters in the literal portion of the pattern', () => {
    expect(
      matchesDltTemplate(
        'You saved Rs. 500 (50%) on your purchase!',
        'You saved Rs. {#var#} (50%) on your purchase!'
      )
    ).toBe(true);
    // A different discount percentage in the LITERAL (non-var) position must still fail —
    // proves "(50%)" is matched literally, not accidentally treated as a wildcard/regex group.
    expect(
      matchesDltTemplate(
        'You saved Rs. 500 (75%) on your purchase!',
        'You saved Rs. {#var#} (50%) on your purchase!'
      )
    ).toBe(false);
  });

  it('rejects a message that is only a prefix/suffix match, not a full match', () => {
    expect(
      matchesDltTemplate(
        'Dear Ramesh, your order ORD1234 has been shipped. Thank you for shopping with us and please visit again soon!',
        'Dear {#var#}, your order {#var#} has been shipped.'
      )
    ).toBe(false);
  });
});

function makeWhereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), { limit: vi.fn().mockResolvedValue(rows) });
}

function makeDb(dltTemplateRows: unknown[] = []) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(() => {
          if (table === crmDltTemplates) return makeWhereResult(dltTemplateRows);
          return makeWhereResult([]); // featureFlags (quiet hours) — none configured
        }),
      })),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi
          .fn()
          .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'log-1' }]) }),
      }),
    }),
  };
}

const mockQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };

describe('NotificationEngine.sendRaw — DLT/TRAI SMS compliance gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fixed at a non-quiet-hour IST time so the quiet-hours check never masks the DLT result.
    vi.setSystemTime(new Date('2026-07-29T05:00:00.000Z')); // 10:30 IST
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a promotional SMS with no registered templates at all', async () => {
    const engine = new NotificationEngine(makeDb([]) as never, mockQueue);
    await expect(
      engine.sendRaw({
        tenantId: 1,
        eventType: 'CRM_CAMPAIGN',
        channel: 'SMS',
        category: 'PROMOTIONAL',
        recipientPhone: '9999999999',
        body: 'Diwali Sale! Flat 50% off, visit us today.',
      })
    ).rejects.toThrow(BusinessError);
  });

  it('rejects a promotional SMS that does not match any registered template', async () => {
    const db = makeDb([
      {
        isActive: true,
        expiresAt: null,
        messagePattern: 'Dear {#var#}, your order {#var#} has been shipped.',
      },
    ]);
    const engine = new NotificationEngine(db as never, mockQueue);
    await expect(
      engine.sendRaw({
        tenantId: 1,
        eventType: 'CRM_CAMPAIGN',
        channel: 'SMS',
        category: 'PROMOTIONAL',
        recipientPhone: '9999999999',
        body: 'Diwali Sale! Flat 50% off, visit us today.',
      })
    ).rejects.toThrow(BusinessError);
  });

  it('accepts a promotional SMS that matches a registered, active template', async () => {
    const db = makeDb([
      {
        isActive: true,
        expiresAt: null,
        messagePattern: 'Dear {#var#}, enjoy {#var#}% off this festive season at {#var#}.',
      },
    ]);
    const engine = new NotificationEngine(db as never, mockQueue);
    const result = await engine.sendRaw({
      tenantId: 1,
      eventType: 'CRM_CAMPAIGN',
      channel: 'SMS',
      category: 'PROMOTIONAL',
      recipientPhone: '9999999999',
      body: 'Dear Ramesh, enjoy 50% off this festive season at Our Store.',
    });
    expect(result.status).toBe('QUEUED');
    expect(mockQueue.enqueue).toHaveBeenCalled();
  });

  it('ignores an expired template even if the content would otherwise match', async () => {
    const db = makeDb([
      {
        isActive: true,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'), // long expired
        messagePattern: 'Dear {#var#}, enjoy {#var#}% off.',
      },
    ]);
    const engine = new NotificationEngine(db as never, mockQueue);
    await expect(
      engine.sendRaw({
        tenantId: 1,
        eventType: 'CRM_CAMPAIGN',
        channel: 'SMS',
        category: 'PROMOTIONAL',
        recipientPhone: '9999999999',
        body: 'Dear Ramesh, enjoy 50% off.',
      })
    ).rejects.toThrow(BusinessError);
  });

  it('never gates a transactional SMS (category omitted) regardless of registered templates', async () => {
    const db = makeDb([]); // zero templates registered
    const engine = new NotificationEngine(db as never, mockQueue);
    const result = await engine.sendRaw({
      tenantId: 1,
      eventType: 'ORDER_CONFIRMATION',
      channel: 'SMS',
      // category omitted — defaults to TRANSACTIONAL, must never be blocked by the DLT gate.
      recipientPhone: '9999999999',
      body: 'Your OTP is 482913. Do not share it with anyone.',
    });
    expect(result.status).toBe('QUEUED');
  });

  it('never gates a non-SMS promotional send (DLT only governs SMS)', async () => {
    const db = makeDb([]);
    const engine = new NotificationEngine(db as never, mockQueue);
    const result = await engine.sendRaw({
      tenantId: 1,
      eventType: 'CRM_CAMPAIGN',
      channel: 'EMAIL',
      category: 'PROMOTIONAL',
      recipientEmail: 'customer@example.com',
      body: 'Big festive sale this week!',
    });
    expect(result.status).toBe('QUEUED');
  });
});
