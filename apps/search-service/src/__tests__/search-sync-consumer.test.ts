// Phase 3 — search-sync Kafka consumer: verifies event-type -> entity/operation mapping
// and that unmapped event types are skipped rather than throwing (a topic subscription
// typo or a future unmapped event type should never crash the consumer loop).
import { describe, it, expect, vi } from 'vitest';
import type { ERPEventPayload } from '@erp/types';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { syncSearchIndex } from '../consumers/SearchSyncConsumer.js';
import { EVENT_ENTITY_MAP, topicForEventType, SEARCH_SYNC_TOPICS } from '../consumers/eventEntityMap.js';

function makeEvent(overrides: Partial<ERPEventPayload>): ERPEventPayload {
  return {
    eventId: 'test-event-id',
    eventType: 'CUSTOMER_CREATED',
    schemaVersion: 1,
    aggregateType: 'customer',
    aggregateId: 42,
    tenantId: 1,
    userId: 1,
    correlationId: 'test-correlation-id',
    causationId: 'test-correlation-id',
    occurredAt: new Date().toISOString(),
    payload: { name: 'Test Customer' },
    ...overrides,
  };
}

function makeEngine(): SearchEngine {
  return {
    index: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as SearchEngine;
}

describe('syncSearchIndex — event dispatch', () => {
  it('an "index" event upserts the document under the mapped entity', async () => {
    const engine = makeEngine();
    const event = makeEvent({ eventType: 'CUSTOMER_UPDATED', aggregateId: 7, tenantId: 3, payload: { name: 'Renamed' } });

    await syncSearchIndex(event, engine);

    expect(engine.index).toHaveBeenCalledWith(3, 'customer', '7', { name: 'Renamed' });
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('a "delete" event removes the document by id, ignoring payload', async () => {
    const engine = makeEngine();
    const event = makeEvent({ eventType: 'CUSTOMER_DELETED', aggregateId: 7, tenantId: 3, payload: { id: 7 } });

    await syncSearchIndex(event, engine);

    expect(engine.delete).toHaveBeenCalledWith(3, 'customer', '7');
    expect(engine.index).not.toHaveBeenCalled();
  });

  it('an unmapped event type is skipped, not thrown', async () => {
    const engine = makeEngine();
    const event = makeEvent({ eventType: 'SOME_UNRELATED_EVENT_NOT_IN_MAP' });

    await expect(syncSearchIndex(event, engine)).resolves.toBeUndefined();
    expect(engine.index).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('multi-word entity names round-trip correctly (e.g. purchase_order, stock_transfer)', async () => {
    const engine = makeEngine();
    await syncSearchIndex(makeEvent({ eventType: 'PO_CREATED', aggregateId: 1, tenantId: 1, payload: {} }), engine);
    await syncSearchIndex(makeEvent({ eventType: 'TRANSFER_DISPATCHED', aggregateId: 2, tenantId: 1, payload: {} }), engine);

    expect(engine.index).toHaveBeenCalledWith(1, 'purchase_order', '1', {});
    expect(engine.index).toHaveBeenCalledWith(1, 'stock_transfer', '2', {});
  });

  it('customer payments and supplier payments get distinct doc ids despite sharing the "payment" entity and independent PK sequences', async () => {
    const engine = makeEngine();
    await syncSearchIndex(makeEvent({ eventType: 'PAYMENT_RECEIVED', aggregateId: 5, tenantId: 1, payload: { amount: 100 } }), engine);
    await syncSearchIndex(makeEvent({ eventType: 'SUPPLIER_PAYMENT_MADE', aggregateId: 5, tenantId: 1, payload: { amount: 200 } }), engine);

    expect(engine.index).toHaveBeenCalledWith(1, 'payment', 'in-5', { amount: 100 });
    expect(engine.index).toHaveBeenCalledWith(1, 'payment', 'out-5', { amount: 200 });
  });
});

describe('topicForEventType / SEARCH_SYNC_TOPICS', () => {
  it('derives the same dotted-lowercase topic convention OutboxPublisher uses', () => {
    expect(topicForEventType('CUSTOMER_CREATED')).toBe('erp.customer.created');
    expect(topicForEventType('PURCHASE_RETURN_APPROVED')).toBe('erp.purchase.return.approved');
  });

  it('subscribes to exactly one topic per mapped event type, no duplicates', () => {
    expect(SEARCH_SYNC_TOPICS.length).toBe(Object.keys(EVENT_ENTITY_MAP).length);
    expect(new Set(SEARCH_SYNC_TOPICS).size).toBe(SEARCH_SYNC_TOPICS.length);
  });
});
