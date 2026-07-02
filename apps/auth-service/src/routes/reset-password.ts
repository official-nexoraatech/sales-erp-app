import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
import { users, passwordResetTokens, refreshTokens } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import argon2 from 'argon2';
import { sha256Hex } from '../crypto.js';

const ResetPasswordBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(128),
});

export async function resetPasswordRoute(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.post('/auth/reset-password', {
    handler: async (request, reply) => {
      const body = ResetPasswordBody.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'Invalid request', details: body.error.flatten() });
      }

      const tokenHash = sha256Hex(body.data.token);
      const now = new Date();

      const [tokenRow] = await db
        .select()
        .from(passwordResetTokens)
        .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
        .limit(1);

      if (!tokenRow || tokenRow.expiresAt < now) {
        return reply.code(400).send({ error: 'Invalid or expired reset token' });
      }

      const passwordHash = await argon2.hash(body.data.newPassword, { type: argon2.argon2id });

      // Mark token used, update password, revoke all refresh tokens (force re-login on all devices)
      await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, tokenRow.id));

      await db
        .update(users)
        .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null, updatedAt: now })
        .where(eq(users.id, tokenRow.userId));

      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, tokenRow.userId), isNull(refreshTokens.revokedAt)));

      return reply.code(200).send({ message: 'Password reset successfully' });
    },
  });
}
