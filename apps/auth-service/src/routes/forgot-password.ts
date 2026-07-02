import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { users, passwordResetTokens } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { generateSecureToken, sha256Hex } from '../crypto.js';
import type { AuthConfig } from '../config.js';

const ForgotPasswordBody = z.object({
  email: z.string().email(),
  tenantId: z.number().int().positive(),
});

export async function forgotPasswordRoute(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig
): Promise<void> {
  fastify.post('/auth/forgot-password', {
    handler: async (request, reply) => {
      const body = ForgotPasswordBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const { email, tenantId } = body.data;

      // Always return 200 to prevent email enumeration
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.tenantId, tenantId), eq(users.isActive, true)))
        .limit(1);

      if (user) {
        const plainToken = generateSecureToken(32);
        const tokenHash = sha256Hex(plainToken);
        const expiresAt = new Date(Date.now() + config.passwordResetTokenTtlMs);

        await db.insert(passwordResetTokens).values({
          userId: user.id,
          tenantId,
          tokenHash,
          expiresAt,
        });

        // In production, send via SMTP. In dev, log the reset link (token is not sensitive itself — only hash stored)
        fastify.log.info(
          { userId: user.id, tenantId, expiresAt },
          'Password reset token generated — deliver via SMTP'
        );
        // TODO (Milestone 0.6): trigger notification-service event for email delivery
      }

      return reply.code(200).send({ message: 'If this email exists, a reset link has been sent' });
    },
  });
}
