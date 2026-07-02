export interface OutboxEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  retryCount: number;
  createdAt: Date;
}
