import type { ERPEventPayload } from '@erp/types';
import { createLogger } from '@erp/logger';
import type { SearchEngine } from '../domain/SearchEngine.js';
import { EVENT_ENTITY_MAP } from './eventEntityMap.js';

const logger = createLogger({ serviceName: 'search-service' });

// The actual sync logic, split out from the DLQ-wrapping dispatcher in main.ts so it's
// unit-testable without a real Kafka/Postgres connection.
export async function syncSearchIndex(event: ERPEventPayload, engine: SearchEngine): Promise<void> {
  const mapping = EVENT_ENTITY_MAP[event.eventType];
  if (!mapping) {
    logger.warn({ eventType: event.eventType }, 'search-service consumer: no entity mapping for event type — skipping');
    return;
  }

  const id = `${mapping.idPrefix ?? ''}${event.aggregateId}`;

  if (mapping.op === 'delete') {
    await engine.delete(event.tenantId, mapping.entity, id);
    return;
  }

  await engine.index(event.tenantId, mapping.entity, id, event.payload);
}
