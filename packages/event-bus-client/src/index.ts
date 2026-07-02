import type { ERPEventPayload } from '@erp/types';

export type { ERPEventPayload };

export interface EventProducer {
  publish(topic: string, event: ERPEventPayload): Promise<void>;
  publishBatch(topic: string, events: ERPEventPayload[]): Promise<void>;
  disconnect(): Promise<void>;
}

export interface EventConsumerConfig {
  groupId: string;
  topics: string[];
  fromBeginning?: boolean;
}

export type EventHandler = (event: ERPEventPayload) => Promise<void>;

export interface EventConsumer {
  subscribe(handler: EventHandler): Promise<void>;
  disconnect(): Promise<void>;
}

export interface EventBusConfig {
  brokers: string[];
  clientId: string;
  ssl?: boolean;
}

export function createEventProducer(_config: EventBusConfig): EventProducer {
  throw new Error('Event producer not implemented — implement with KafkaJS in Milestone 0.4');
}

export function createEventConsumer(
  _config: EventBusConfig,
  _consumerConfig: EventConsumerConfig
): EventConsumer {
  throw new Error('Event consumer not implemented — implement with KafkaJS in Milestone 0.4');
}
