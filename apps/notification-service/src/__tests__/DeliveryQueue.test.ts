// Architectural tier (2026-07-23 audit): DeliveryQueue moves channel delivery + retry off the
// request thread onto a BullMQ worker. bullmq itself needs a live Redis connection to construct
// a real Queue/Worker, so this test mocks the module and captures the processor function passed
// to `new Worker(name, processor, opts)` — invoking it directly simulates what BullMQ would do
// per job attempt, without needing Redis.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@erp/db', () => ({
  notificationLog: new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) }),
  outboxEvents: new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
}));

const sendMock = vi.fn();
vi.mock('../domain/channels/ChannelRegistry.js', () => ({
  ChannelRegistry: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue({ send: sendMock }),
  })),
}));

type Processor = (job: {
  data: { logId: number; tenantId: number; channel: string; params: unknown };
  attemptsMade: number;
  opts: { attempts?: number };
}) => Promise<void>;

let capturedProcessor: Processor | undefined;
let capturedFailedHandler: ((job: unknown, err: Error) => void) | undefined;
const queueAddMock = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: queueAddMock,
    close: vi.fn(),
  })),
  Worker: vi.fn().mockImplementation((_name: string, processor: Processor) => {
    capturedProcessor = processor;
    return {
      on: vi.fn((event: string, handler: (job: unknown, err: Error) => void) => {
        if (event === 'failed') capturedFailedHandler = handler;
      }),
      close: vi.fn(),
    };
  }),
}));

import { DeliveryQueue } from '../domain/DeliveryQueue.js';

function makeDb() {
  const updateSetWhere = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockResolvedValue(undefined);
  return {
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateSetWhere }) }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    updateSetWhere,
    insertValues,
  };
}

describe('DeliveryQueue', () => {
  beforeEach(() => {
    sendMock.mockReset();
    queueAddMock.mockClear();
    capturedProcessor = undefined;
    capturedFailedHandler = undefined;
  });

  it('enqueue() adds a job to the BullMQ queue with the given data', async () => {
    const db = makeDb();
    const queue = new DeliveryQueue({} as never, db as never, {} as never);

    await queue.enqueue({
      logId: 1,
      tenantId: 1,
      channel: 'EMAIL',
      params: { body: 'hi', tenantId: 1 },
    });

    expect(queueAddMock).toHaveBeenCalledWith(
      'deliver',
      expect.objectContaining({ logId: 1, tenantId: 1, channel: 'EMAIL' })
    );
  });

  it('processor marks the row SENT and publishes an outbox event on successful delivery', async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _queue = new DeliveryQueue({} as never, db as never, {} as never);
    sendMock.mockResolvedValue({ externalId: 'ext-123' });

    await capturedProcessor!({
      data: { logId: 1, tenantId: 5, channel: 'EMAIL', params: { body: 'hi' } },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.updateSetWhere).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'NOTIFICATION_DELIVERY_UPDATED',
        tenantId: 5,
        payload: expect.objectContaining({ notificationLogId: 1, status: 'SENT' }),
      })
    );
  });

  it('processor records attemptCount and rethrows on a failed delivery attempt (no outbox event yet)', async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _queue = new DeliveryQueue({} as never, db as never, {} as never);
    sendMock.mockRejectedValue(new Error('provider down'));

    await expect(
      capturedProcessor!({
        data: { logId: 1, tenantId: 5, channel: 'EMAIL', params: { body: 'hi' } },
        attemptsMade: 0,
        opts: { attempts: 3 },
      })
    ).rejects.toThrow('provider down');

    expect(db.update).toHaveBeenCalledTimes(1); // attemptCount bump only, not a status change
    expect(db.insert).not.toHaveBeenCalled(); // not terminal yet — no outbox event
  });

  it("worker 'failed' handler marks the row FAILED and publishes an outbox event only on the final attempt", async () => {
    const db = makeDb();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _queue = new DeliveryQueue({} as never, db as never, {} as never);

    const job = {
      data: { logId: 1, tenantId: 5, channel: 'EMAIL', params: {} },
      attemptsMade: 2,
      opts: { attempts: 3 },
    };
    // Not yet the final attempt (2 of 3) — should NOT mark terminal.
    capturedFailedHandler!(job, new Error('still retrying'));
    await new Promise((r) => setTimeout(r, 0));
    expect(db.insert).not.toHaveBeenCalled();

    // Final attempt (3 of 3) — should mark terminal.
    const finalJob = { ...job, attemptsMade: 3 };
    capturedFailedHandler!(finalJob, new Error('gave up'));
    await new Promise((r) => setTimeout(r, 0));
    expect(db.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'NOTIFICATION_DELIVERY_UPDATED',
        payload: expect.objectContaining({ notificationLogId: 1, status: 'FAILED' }),
      })
    );
  });
});
