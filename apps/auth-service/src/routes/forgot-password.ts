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

// Fire-and-forget: mirrors the internal-call pattern used by hr-service's alteration
// notifications and sales-service's InvoiceNotificationService. Deliberately not awaited —
// awaiting a cross-service call here (only reachable when the user exists) would leak a
// timing side-channel that defeats the enumeration protection below.
function sendPasswordResetEmail(
  fastify: FastifyInstance,
  input: { tenantId: number; userId: number; email: string; resetLink: string }
): void {
  const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
  const internalKey = process.env['INTERNAL_API_KEY'] ?? '';

  fetch(`${notificationUrl}/notifications/send-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      tenantId: input.tenantId,
      eventType: 'PASSWORD_RESET_REQUESTED',
      recipientUserId: input.userId,
      recipientEmail: input.email,
      channels: ['EMAIL'],
      templateData: { resetLink: input.resetLink },
    }),
  }).catch((err) => {
    fastify.log.warn(
      { err, userId: input.userId },
      'Password reset email delivery failed (non-fatal)'
    );
  });
}

export async function forgotPasswordRoute(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: AuthConfig
): Promise<void> {
  fastify.post('/auth/forgot-password', {
    config: {
      rateLimit: {
        max: config.forgotPasswordRateLimitMax,
        timeWindow: config.forgotPasswordRateLimitWindowMs,
      },
    },
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

        const resetLink = `${config.frontendUrl}/reset-password?token=${plainToken}`;
        sendPasswordResetEmail(fastify, {
          tenantId,
          userId: user.id,
          email: user.email,
          resetLink,
        });

        if (config.nodeEnv !== 'production') {
          fastify.log.debug(
            { userId: user.id, tenantId, resetLink },
            'Password reset requested (dev only)'
          );
        }
      }

      return reply.code(200).send({ message: 'If this email exists, a reset link has been sent' });
    },
  });
}
