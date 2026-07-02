import type { FastifyInstance } from 'fastify';
import type { OutboxRelayWorker } from '../outbox/OutboxRelayWorker.js';

export async function healthOutboxRoutes(
  fastify: FastifyInstance,
  worker: OutboxRelayWorker
): Promise<void> {
  fastify.get('/health/outbox', async (_req, reply) => {
    const [queueDepth, dbDeadLetterCount] = await Promise.all([
      worker.getQueueDepth(),
      worker.getDbDeadLetterCount(),
    ]);

    const deadLetterCount = dbDeadLetterCount;
    const lastPublishedAt = worker.getLastPublishedAt();

    return reply.code(200).send({
      status: deadLetterCount > 0 ? 'degraded' : 'ok',
      queueDepth,
      lastPublishedAt: lastPublishedAt ? lastPublishedAt.toISOString() : null,
      deadLetterCount,
    });
  });
}
