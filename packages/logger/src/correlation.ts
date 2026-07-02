import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const CAUSATION_ID_HEADER = 'x-causation-id';

export function generateCorrelationId(): string {
  return randomUUID();
}

// Fastify plugin-compatible hook factory
// Usage: fastify.addHook('onRequest', correlationIdHook)
export function createCorrelationIdHook() {
  return async function correlationIdHook(
    request: { headers: Record<string, string | string[] | undefined>; correlationId?: string },
    reply: { header: (name: string, value: string) => void }
  ): Promise<void> {
    const incoming = request.headers[CORRELATION_ID_HEADER];
    const correlationId = (Array.isArray(incoming) ? incoming[0] : incoming) ?? generateCorrelationId();
    request.correlationId = correlationId;
    reply.header(CORRELATION_ID_HEADER, correlationId);
  };
}
