import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { refreshTokens } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { sha256Hex } from '../crypto.js';

const LogoutBody = z.object({
  refreshToken: z.string().min(1),
});

export async function logoutRoute(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.post('/auth/logout', {
    handler: async (request, reply) => {
      const body = LogoutBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const tokenHash = sha256Hex(body.data.refreshToken);
      const now = new Date();

      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));

      return reply.code(200).send({ message: 'Logged out successfully' });
    },
  });
}
