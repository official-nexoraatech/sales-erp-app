// CRM-ROADMAP Phase 4, Feature 7 — CTI / Call Center Integration.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, users, customers, crmCallLogs } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValidationError, NotFoundError } from '@erp/types';
import { CallService } from '../domain/CallService.js';

const DB_URL = process.env['DATABASE_URL'];
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

describe.skipIf(!DB_URL)('CallService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 910_801 + Math.floor(Math.random() * 1000);
  let repX: number;
  let repNoPhone: number;
  let customerA: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'CTI Branch',
        code: 'CTI',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    const userRows = await db
      .insert(users)
      .values([
        {
          tenantId: TEST_TENANT,
          email: `repx-cti-${TEST_TENANT}@test.local`,
          passwordHash: 'x',
          firstName: 'Rep',
          lastName: 'X',
          phone: '9998887770',
        },
        {
          tenantId: TEST_TENANT,
          email: `repnophone-cti-${TEST_TENANT}@test.local`,
          passwordHash: 'x',
          firstName: 'Rep',
          lastName: 'NoPhone',
        },
      ])
      .returning();
    [repX, repNoPhone] = userRows.map((u) => u.id) as [number, number];

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId: branch!.id,
        displayName: 'CTI Customer',
        customerCode: `CTI-${TEST_TENANT}`,
        phone: '9000000099',
        createdBy: 1,
      } as unknown as typeof customers.$inferInsert)
      .returning();
    customerA = customer!.id;

    process.env['TWILIO_ACCOUNT_SID'] = 'ACtest';
    process.env['TWILIO_AUTH_TOKEN'] = 'test-auth-token';
    process.env['TWILIO_CALLER_NUMBER'] = '+15550001111';
    process.env['TWILIO_VOICE_WEBHOOK_URL'] =
      'https://gateway.example.com/api/sales/webhooks/twilio/voice';
    process.env['TWILIO_STATUS_WEBHOOK_URL'] =
      'https://gateway.example.com/api/sales/webhooks/twilio/status';
    process.env['TWILIO_RECORDING_WEBHOOK_URL'] =
      'https://gateway.example.com/api/sales/webhooks/twilio/recording';
  });

  afterAll(async () => {
    await db.delete(crmCallLogs).where(eq(crmCallLogs.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(users).where(eq(users.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('initiateCall rejects when the rep has no phone number set', async () => {
    await expect(
      CallService.initiateCall(db, TEST_TENANT, repNoPhone, { toNumber: '9000000099' })
    ).rejects.toThrow(ValidationError);
  });

  it('initiateCall creates a real crm_call_logs row from the Twilio API response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: `CA-${TEST_TENANT}-1`, status: 'queued' }), {
        status: 201,
      })
    ) as unknown as typeof fetch;

    const call = await CallService.initiateCall(db, TEST_TENANT, repX, {
      customerId: customerA,
      toNumber: '9000000099',
    });
    expect(call.status).toBe('INITIATED');
    expect(call.twilioCallSid).toBe(`CA-${TEST_TENANT}-1`);
    expect(call.direction).toBe('OUTBOUND');
    expect(call.fromNumber).toBe('+15550001111');
  });

  it('initiateCall throws when Twilio returns a non-OK response', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('bad request', { status: 400 })) as unknown as typeof fetch;
    await expect(
      CallService.initiateCall(db, TEST_TENANT, repX, { toNumber: '9000000099' })
    ).rejects.toThrow();
  });

  it('handleStatusCallback updates the matching call log by CallSid and sets endedAt on a terminal status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: `CA-${TEST_TENANT}-2`, status: 'queued' }), {
        status: 201,
      })
    ) as unknown as typeof fetch;
    const call = await CallService.initiateCall(db, TEST_TENANT, repX, { toNumber: '9000000099' });

    await CallService.handleStatusCallback(db, {
      callSid: call.twilioCallSid,
      status: 'completed',
      durationSeconds: 37,
    });

    const [updated] = await db.select().from(crmCallLogs).where(eq(crmCallLogs.id, call.id));
    expect(updated!.status).toBe('COMPLETED');
    expect(updated!.durationSeconds).toBe(37);
    expect(updated!.endedAt).not.toBeNull();
  });

  it('handleStatusCallback is a no-op (does not throw) for an unknown CallSid', async () => {
    await expect(
      CallService.handleStatusCallback(db, { callSid: 'CA-unknown-sid', status: 'completed' })
    ).resolves.toBeUndefined();
  });

  it('handleRecordingCallback is a no-op when recording is not enabled', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: `CA-${TEST_TENANT}-3`, status: 'queued' }), {
        status: 201,
      })
    ) as unknown as typeof fetch;
    const call = await CallService.initiateCall(db, TEST_TENANT, repX, { toNumber: '9000000099' });

    await CallService.handleRecordingCallback(db, {
      callSid: call.twilioCallSid,
      recordingUrl: 'https://api.twilio.com/recording.mp3',
    });

    const [after] = await db.select().from(crmCallLogs).where(eq(crmCallLogs.id, call.id));
    expect(after!.recordingUrl).toBeNull();
  });

  it('listCalls scopes to the caller rep unless canViewAll', async () => {
    const ownOnly = await CallService.listCalls(
      db,
      TEST_TENANT,
      { canViewAll: false, callerId: repX },
      {}
    );
    expect(ownOnly.every((c) => c.repUserId === repX)).toBe(true);

    const all = await CallService.listCalls(
      db,
      TEST_TENANT,
      { canViewAll: true, callerId: repX },
      {}
    );
    expect(all.length).toBeGreaterThanOrEqual(ownOnly.length);
  });

  it('addNotes throws NotFoundError when a different rep attempts to annotate the call', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sid: `CA-${TEST_TENANT}-4`, status: 'queued' }), {
        status: 201,
      })
    ) as unknown as typeof fetch;
    const call = await CallService.initiateCall(db, TEST_TENANT, repX, { toNumber: '9000000099' });

    await expect(
      CallService.addNotes(db, TEST_TENANT, repNoPhone, call.id, 'not mine')
    ).rejects.toThrow(NotFoundError);
    const updated = await CallService.addNotes(db, TEST_TENANT, repX, call.id, 'Left voicemail');
    expect(updated.notes).toBe('Left voicemail');
  });
});
