import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { ReferralService } from '../domain/ReferralService.js';

// CRM-ROADMAP Phase 2, Feature 4 — Referral Program Engine.
//
// Both routes here are PUBLIC (no `authenticate` preHandler) by necessity — a referee clicking
// a shared referral link or redeeming a code isn't logged into this ERP. Same security posture
// as the pre-existing public /leads/capture route (06-SECURITY-PLAN.md §2.1): every field is
// hostile input, rate-limited, and a honeypot field silently no-ops a bot fill rather than
// telling it it was caught.
const WEB_FRONTEND_URL = process.env['WEB_FRONTEND_URL'] ?? 'http://localhost:5173';

const RedeemSchema = z.object({
  code: z.string().min(4).max(20),
  refereeName: z.string().max(200).optional(),
  refereePhone: z.string().min(10).max(20),
  deviceId: z.string().max(100).optional(),
  hp: z.string().max(200).optional(),
});

export async function referralPublicRoutes(
  fastify: FastifyInstance,
  _ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── GET /r/:code — referral link click redirect ─────────────────────────────
  fastify.get<{ Params: { code: string } }>('/r/:code', async (request, reply) => {
    const { createDatabaseClient } = await import('@erp/db');
    const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });
    const { code } = request.params;

    // Best-effort — a failed click-write must never block or slow the redirect itself, same
    // discipline as link-tracking.routes.ts's own click route.
    try {
      await ReferralService.trackClick(db, code, request.ip, undefined);
    } catch {
      // Swallow — the redirect must still happen even if the click write failed.
    }

    // Always redirects to OUR OWN landing page with the code as a path segment — never an
    // attacker-supplied destination, closing the same open-redirect vector
    // link-tracking.routes.ts's own comment describes.
    return reply.redirect(`${WEB_FRONTEND_URL}/refer/${encodeURIComponent(code)}`, 302);
  });

  // ── POST /referral/redeem — public, rate-limited, fraud-gated ───────────────
  fastify.post(
    '/referral/redeem',
    {
      config: {
        rateLimit: {
          max: parseInt(process.env['REFERRAL_REDEEM_RATE_LIMIT_MAX'] ?? '5', 10),
          timeWindow: parseInt(process.env['REFERRAL_REDEEM_RATE_LIMIT_WINDOW_MS'] ?? '600000', 10),
        },
      },
    },
    async (request, reply) => {
      const body = RedeemSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // Honeypot tripped — fake success without ever touching the database, same as
      // /leads/capture's own honeypot handling.
      if (body.data.hp) {
        return reply.code(201).send({ data: { id: 0 } });
      }

      const { createDatabaseClient } = await import('@erp/db');
      const db = createDatabaseClient({ url: process.env['DATABASE_URL']! });

      const reward = await ReferralService.redeem(db, {
        code: body.data.code,
        refereeName: body.data.refereeName,
        refereePhone: body.data.refereePhone,
        ipAddress: request.ip,
        deviceId: body.data.deviceId,
      });

      return reply.code(201).send({ data: { id: reward.id, status: reward.status } });
    }
  );
}
