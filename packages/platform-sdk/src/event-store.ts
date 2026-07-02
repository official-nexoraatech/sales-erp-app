import { eq, and, desc, asc, gt, gte, lte } from 'drizzle-orm';
import { eventStore, eventSnapshots } from '@erp/db';
import type { TenantScopedDatabase } from './database.js';

export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion?: number;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  userId?: number;
  occurredAt?: Date;
}

export interface EventStoreQuery {
  aggregateType?: string;
  aggregateId?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AggregateState {
  aggregateType: string;
  aggregateId: string;
  version: number;
  state: Record<string, unknown>;
  events: DomainEvent[];
}

const SNAPSHOT_THRESHOLD = parseInt(process.env['EVENT_STORE_SNAPSHOT_THRESHOLD'] ?? '50', 10);

export class EventStoreService {
  constructor(
    private readonly db: TenantScopedDatabase,
    private readonly tenantId: number
  ) {}

  async append(event: DomainEvent): Promise<void> {
    const raw = this.db.raw;

    // Get current version for this aggregate
    const existing = await raw
      .select({ version: eventStore.aggregateVersion })
      .from(eventStore)
      .where(
        and(
          eq(eventStore.tenantId, this.tenantId),
          eq(eventStore.aggregateType, event.aggregateType),
          eq(eventStore.aggregateId, event.aggregateId)
        )
      )
      .orderBy(desc(eventStore.aggregateVersion))
      .limit(1);

    const currentVersion = existing[0]?.version ?? 0;
    const nextVersion = currentVersion + 1;

    await raw.insert(eventStore).values({
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      aggregateVersion: nextVersion,
      tenantId: this.tenantId,
      schemaVersion: event.schemaVersion ?? 1,
      payload: event.payload as Record<string, unknown>,
      metadata: (event.metadata ?? {}) as Record<string, unknown>,
      correlationId: event.correlationId,
      causationId: event.causationId,
      userId: event.userId,
      occurredAt: event.occurredAt ?? new Date(),
    });

    // Check if snapshot is needed (every SNAPSHOT_THRESHOLD events)
    if (nextVersion % SNAPSHOT_THRESHOLD === 0) {
      const allEvents = await this.getHistory(event.aggregateType, event.aggregateId);
      const state = this.buildStateFromEvents(allEvents);
      await this.snapshot(event.aggregateType, event.aggregateId, nextVersion, state);
    }
  }

  async getHistory(aggregateType: string, aggregateId: string): Promise<DomainEvent[]> {
    const rows = await this.db.raw
      .select()
      .from(eventStore)
      .where(
        and(
          eq(eventStore.tenantId, this.tenantId),
          eq(eventStore.aggregateType, aggregateType),
          eq(eventStore.aggregateId, aggregateId)
        )
      )
      .orderBy(asc(eventStore.aggregateVersion));

    return rows.map(this.rowToEvent);
  }

  async rebuild(aggregateType: string, aggregateId: string): Promise<AggregateState> {
    // Check for snapshot first
    const snap = await this.db.raw
      .select()
      .from(eventSnapshots)
      .where(
        and(
          eq(eventSnapshots.tenantId, this.tenantId),
          eq(eventSnapshots.aggregateType, aggregateType),
          eq(eventSnapshots.aggregateId, aggregateId)
        )
      )
      .limit(1);

    const snapshot = snap[0];

    // Get events after snapshot (or all events)
    const baseConditions = [
      eq(eventStore.tenantId, this.tenantId),
      eq(eventStore.aggregateType, aggregateType),
      eq(eventStore.aggregateId, aggregateId),
    ];
    if (snapshot) baseConditions.push(gt(eventStore.aggregateVersion, snapshot.version));

    const eventsQuery = this.db.raw
      .select()
      .from(eventStore)
      .where(and(...baseConditions))
      .orderBy(asc(eventStore.aggregateVersion));

    const eventRows = await eventsQuery;
    const events = eventRows.map(this.rowToEvent);

    const baseState = snapshot ? (snapshot.state as Record<string, unknown>) : {};
    const state = this.applyEvents(baseState, events);
    const version = snapshot ? snapshot.version + events.length : events.length;

    return { aggregateType, aggregateId, version, state, events };
  }

  async query(filters: EventStoreQuery): Promise<DomainEvent[]> {
    const conditions = [eq(eventStore.tenantId, this.tenantId)];

    if (filters.aggregateType) conditions.push(eq(eventStore.aggregateType, filters.aggregateType));
    if (filters.aggregateId) conditions.push(eq(eventStore.aggregateId, filters.aggregateId));
    if (filters.eventType) conditions.push(eq(eventStore.eventType, filters.eventType));
    if (filters.from) conditions.push(gte(eventStore.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(eventStore.occurredAt, filters.to));

    const rows = await this.db.raw
      .select()
      .from(eventStore)
      .where(and(...conditions))
      .orderBy(desc(eventStore.occurredAt))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0);

    return rows.map(this.rowToEvent);
  }

  private rowToEvent(r: {
    eventId: string; eventType: string; aggregateType: string; aggregateId: string;
    schemaVersion: number; payload: unknown; metadata: unknown;
    correlationId: string | null; causationId: string | null; userId: number | null;
    occurredAt: Date;
  }): DomainEvent {
    const event: DomainEvent = {
      eventId: r.eventId,
      eventType: r.eventType,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      schemaVersion: r.schemaVersion,
      payload: r.payload as Record<string, unknown>,
      metadata: r.metadata as Record<string, unknown>,
      occurredAt: r.occurredAt,
    };
    if (r.correlationId !== null) event.correlationId = r.correlationId;
    if (r.causationId !== null) event.causationId = r.causationId;
    if (r.userId !== null) event.userId = r.userId;
    return event;
  }

  private async snapshot(
    aggregateType: string,
    aggregateId: string,
    version: number,
    state: Record<string, unknown>
  ): Promise<void> {
    await this.db.raw
      .insert(eventSnapshots)
      .values({
        aggregateType,
        aggregateId,
        tenantId: this.tenantId,
        version,
        state: state as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [eventSnapshots.tenantId, eventSnapshots.aggregateType, eventSnapshots.aggregateId],
        set: { version, state: state as Record<string, unknown>, createdAt: new Date() },
      });
  }

  // Simple event sourcing — applies events to build state
  private buildStateFromEvents(events: DomainEvent[]): Record<string, unknown> {
    return this.applyEvents({}, events);
  }

  private applyEvents(base: Record<string, unknown>, events: DomainEvent[]): Record<string, unknown> {
    let state = { ...base };
    for (const event of events) {
      state = this.applyEvent(state, event);
    }
    return state;
  }

  private applyEvent(state: Record<string, unknown>, event: DomainEvent): Record<string, unknown> {
    switch (event.eventType) {
      case 'INVOICE_CREATED':
        return { ...state, ...event.payload, status: 'DRAFT', version: (event.payload['version'] as number) ?? 1 };
      case 'INVOICE_CONFIRMED':
        return { ...state, status: 'CONFIRMED', confirmedAt: event.occurredAt?.toISOString() };
      case 'INVOICE_CANCELLED':
        return { ...state, status: 'CANCELLED', cancelledAt: event.occurredAt?.toISOString(), cancelReason: event.payload['reason'] };
      case 'PAYMENT_RECEIVED':
        return {
          ...state,
          paidAmount: ((state['paidAmount'] as number) ?? 0) + ((event.payload['amount'] as number) ?? 0),
          lastPaymentAt: event.occurredAt?.toISOString(),
        };
      case 'CREDIT_NOTE_APPLIED':
        return {
          ...state,
          creditNoteAmount: ((state['creditNoteAmount'] as number) ?? 0) + ((event.payload['amount'] as number) ?? 0),
        };
      default:
        return { ...state, lastEvent: event.eventType, lastEventAt: event.occurredAt?.toISOString() };
    }
  }
}
