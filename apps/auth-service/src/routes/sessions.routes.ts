import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { activeSessions, refreshTokens, securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { inetParam } from '../db-helpers.js';

const ParamsSchema = z.object({ sessionId: z.string().uuid() });

export async function sessionsRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.get('/sessions', {
    handler: async (request, reply) => {
      const { userId, tenantId } = request.auth;
      const sessions = await db
        .select()
        .from(activeSessions)
        .where(and(eq(activeSessions.userId, userId), eq(activeSessions.tenantId, tenantId)))
        .orderBy(desc(activeSessions.lastSeenAt));

      return reply.code(200).send({ data: sessions });
    },
  });

  fastify.delete('/sessions/:sessionId', {
    handler: async (request, reply) => {
      const params = ParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Invalid session id' });

      const { userId, tenantId } = request.auth;
      const [session] = await db
        .select()
        .from(activeSessions)
        .where(
          and(
            eq(activeSessions.id, params.data.sessionId),
            eq(activeSessions.userId, userId),
            eq(activeSessions.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!session) return reply.code(404).send({ error: 'Session not found' });

      if (session.refreshTokenId !== null) {
        await db
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.id, session.refreshTokenId));
      }

      await db.delete(activeSessions).where(eq(activeSessions.id, session.id));

      await db.insert(securityAuditLog).values({
        tenantId,
        actorId: userId,
        targetUserId: userId,
        action: 'SESSION_TERMINATED',
        ipAddress: inetParam(request.ip),
        details: { sessionId: session.id },
      });

      return reply.code(200).send({ message: 'Session terminated' });
    },
  });
}
